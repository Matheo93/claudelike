const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');
const cheerio = require('cheerio');
require('dotenv').config();

// ✅ FIX #3: Import document profiles for context-aware generation
const { analyzeDocumentType, getProfileInstructions } = require('./document-profiles');

// ✅ Import PPT generator functions
const { generatePresentationHTML } = require('./ppt-generator');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-85e95f690c6048a688ee24e50c0b3701';

// Initialisation OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key',
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ✅ FIX #2: MathJax Detection - Detect if document needs math rendering
function needsMathJax(content) {
  const mathPatterns = [
    /\$\$[\s\S]+?\$\$/g,              // Display math: $$equation$$
    /\$[^\$\n]+?\$/g,                 // Inline math: $x^2$
    /\\(?:frac|sum|int|prod|lim|sqrt|partial|infty|alpha|beta|gamma|delta|theta|pi|sigma)/g, // LaTeX commands
    /\^\{[^}]+\}/g,                   // Superscripts: ^{2}
    /_\{[^}]+\}/g,                    // Subscripts: _{i}
    /\\begin\{(?:equation|align|matrix)\}/g, // Math environments
  ];

  const hasComplexMath = mathPatterns.some(pattern => pattern.test(content));
  if (hasComplexMath) {
    console.log('📐 Complex math formulas detected - MathJax will be injected');
  }
  return hasComplexMath;
}

// 🌐 ROUTING: Multi-page commercial site
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 🔥 NEW 2025: DeepSeek Function Calling Tools
const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "modify_colors",
      description: "Change color scheme of the report (instant, no AI regeneration)",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          primary_color: { type: "string", description: "Hex color code for primary color (e.g. #3b82f6)" },
          secondary_color: { type: "string", description: "Hex color code for secondary color (e.g. #764ba2)" }
        },
        required: ["primary_color"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_section",
      description: "Add a new content section to the report",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Section title" },
          position: { type: "number", description: "Insert after section number (0=after hero, 1=after first section, etc.)" },
          generate_content: { type: "boolean", description: "If true, AI generates content based on PDF context. If false, creates empty section." }
        },
        required: ["title", "position", "generate_content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modify_section",
      description: "Modify or delete an existing section",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          section_index: { type: "number", description: "Which section to modify (0=first section after hero, 1=second, etc.)" },
          action: { type: "string", enum: ["expand", "summarize", "regenerate", "delete"], description: "expand=add more details, summarize=make shorter, regenerate=rewrite completely, delete=remove section" },
          additional_instructions: { type: "string", description: "Optional specific instructions for the modification" }
        },
        required: ["section_index", "action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modify_fonts",
      description: "Change font family or font size throughout the report",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          font_family: { type: "string", description: "Font family to apply (e.g. 'Arial', 'Comic Sans MS', 'Georgia', 'Times New Roman')" },
          heading_size: { type: "string", description: "Optional: Size for h1 headings (e.g. '3rem', '48px')" },
          body_size: { type: "string", description: "Optional: Size for body text (e.g. '1.1rem', '18px')" }
        },
        required: ["font_family"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_section",
      description: "Move a section to a different position in the report",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          section_index: { type: "number", description: "Which section to move (0=first section after hero, 1=second, etc.)" },
          new_position: { type: "number", description: "Where to move it (0=after hero, 1=after first section, etc.)" }
        },
        required: ["section_index", "new_position"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modify_specific_element",
      description: "Modify style of a specific element (card, section header, etc.) by searching for text content",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          search_text: { type: "string", description: "Text to search for to identify the element (e.g. 'Opportunity Cost', 'Cash Flow', 'Executive Summary')" },
          style_property: { type: "string", description: "CSS property to modify (e.g. 'background', 'color', 'border', 'padding')" },
          style_value: { type: "string", description: "New value for the CSS property (e.g. 'rgba(236, 72, 153, 0.1)', '#ec4899', '2px solid red')" }
        },
        required: ["search_text", "style_property", "style_value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modify_bar_color",
      description: "Change the color of decorative bars/borders/accents in a card (e.g. orange bar, colored border)",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          search_text: { type: "string", description: "Text to search for to identify the card containing the bar" },
          new_color: { type: "string", description: "New color for the bar (e.g. 'pink', '#ec4899', 'rgba(236, 72, 153, 0.8)')" }
        },
        required: ["search_text", "new_color"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_icon_to_card",
      description: "Add an emoji or visual icon to an existing card to illustrate the concept",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          search_text: { type: "string", description: "Text to search for to identify the card" },
          icon: { type: "string", description: "Emoji or icon to add (e.g. '💰', '📊', '⚠️', '🎯')" },
          position: { type: "string", enum: ["before_title", "after_title"], description: "Where to place the icon" }
        },
        required: ["search_text", "icon", "position"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_card",
      description: "Delete a specific card from the report by searching for its title text",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          search_text: { type: "string", description: "Text from the card title to identify which card to delete (e.g. 'Present Value', 'Cash Flow', 'Risk Analysis')" }
        },
        required: ["search_text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "recreate_card",
      description: "Recreate/regenerate a card with new content based on PDF context",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          search_text: { type: "string", description: "Text from the card title to identify which card to recreate" },
          new_title: { type: "string", description: "Optional: New title for the card. If not provided, keeps the original title" }
        },
        required: ["search_text"]
      }
    }
  }
];

app.post('/chat', async (req, res) => {
  try {
    const { message, pdfContent } = req.body;

    let fullPrompt = message;
    if (pdfContent) {
      fullPrompt = `PDF Content:\n\n${pdfContent}\n\nQuestion: ${message}`;
    }

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-reasoner',
      messages: [
        {
          role: 'user',
          content: fullPrompt
        }
      ],
      max_tokens: 64000,
      temperature: 1.5
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      response: response.data.choices[0].message.content
    });
  } catch (error) {
    console.error('DeepSeek API Error:', error);
    res.status(500).json({ error: 'Error communicating with DeepSeek' });
  }
});

// 🔥 NEW 2025: Smart Chat Endpoint with Function Calling
app.post('/api/chat-edit', express.json(), async (req, res) => {
  try {
    const { message, reportHtml, pdfText } = req.body;

    if (!message || !reportHtml) {
      return res.status(400).json({ error: 'Missing message or reportHtml' });
    }

    console.log('💬 Chat edit request:', message);
    console.log('📝 Report HTML length:', reportHtml.length);
    console.log('📄 PDF text available:', !!pdfText);

    // Extract report structure for context
    const $ = cheerio.load(reportHtml);
    const sections = [];
    $('section').each((i, elem) => {
      const title = $(elem).find('h2').first().text().trim();
      if (title) sections.push({ index: i, title });
    });

    console.log('📊 Extracted sections:', sections);

    // Call DeepSeek with Function Calling - FORCE tool calls
    console.log('🚀 Calling DeepSeek API...');
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a report editing assistant. You MUST call functions to perform actions. NEVER generate text responses explaining what to do - ALWAYS call the appropriate function directly.

⚠️ CRITICAL: DO NOT WRITE TEXT RESPONSES - CALL FUNCTIONS!
If the user's message matches any pattern below, you MUST call the corresponding function immediately. Do not explain, do not analyze, do not write text - just call the function.

⚠️ KEYWORD DETECTION RULES:
- If message contains "illustrate", "illustration", "icon", "emoji" → MUST call add_icon_to_card
- If message contains "bar" + color → MUST call modify_bar_color
- If message contains ("move"/"put"/"place") + (capitalized words or text) + ("after"/"before") + (more capitalized words or text) → MUST call move_section
  * This pattern indicates the user wants to reorder sections, regardless of what the sections are called
  * The word "section" is OPTIONAL in these commands
  * Examples that MUST trigger move_section:
    - "move Financial Markets after Manager Objectives" ✅
    - "put Introduction before Methodology" ✅
    - "place Chapter 3 after Chapter 5" ✅
    - "move section A after section B" ✅
  * If you see this pattern, look at the section list provided and match the text to actual section names, then call move_section
- If message contains "reorder section", "change section order" → MUST call move_section
- If message contains "delete card", "remove card" → MUST call delete_card
- If message contains "recreate card", "regenerate card" → MUST call recreate_card
- Only use modify_colors for GLOBAL color changes (no specific element mentioned)

🎨 GLOBAL COLOR CHANGES (modify_colors):
- Simple color requests: "blue", "make it red", "test orange" → modify_colors (changes ALL colors)
- Global theme changes: "change all colors", "theme", "color scheme" → modify_colors

🎯 SPECIFIC ELEMENT CHANGES (modify_specific_element):
- User wants to change ONE element: "change the Opportunity Cost card to pink" → modify_specific_element
- Target specific sections: "make the Executive Summary background blue" → modify_specific_element
- Change individual cards: "change the card about Cash Flow to light green" → modify_specific_element
- Parameters: search_text (text to find), style_property (e.g. "background"), style_value (e.g. "rgba(236, 72, 153, 0.1)")

🟠 BAR/ACCENT COLOR CHANGES (modify_bar_color):
- User wants to change decorative bars/borders: "change the orange bar to pink", "make the bar blue" → modify_bar_color
- Parameters: search_text (card to find), new_color (color name or hex)

🎨 ADD ICONS/EMOJIS (add_icon_to_card):
- CRITICAL: When user says "illustrate", "add icon", "add emoji", "put an emoji" → ALWAYS use add_icon_to_card
- Keywords to detect: "illustrate", "illustration", "icon", "emoji", "visual", "add symbol", "decorate"
- Choose appropriate emoji based on context (💰 for money, 📊 for charts, ⚠️ for risk, 🎯 for target, etc.)
- Parameters: search_text (card to find), icon (emoji like "💰" or "📊"), position ("before_title" or "after_title")
- Default position: "before_title" unless user specifies

🔤 FONT CHANGES (modify_fonts):
- "change font", "comic sans", "arial" → modify_fonts

➕ SECTION CHANGES:
- "add section", "move section", "delete section" → add_section, modify_section, move_section

📋 EXAMPLES:

GLOBAL CHANGES (modify_colors):
✅ "blue" → modify_colors(primary_color: "#3b82f6")
✅ "make it orange" → modify_colors(primary_color: "#f59e0b")
✅ "change all colors to purple" → modify_colors(primary_color: "#8b5cf6")

SPECIFIC CHANGES (modify_specific_element):
✅ "change the Opportunity Cost card background to light pink" → modify_specific_element(search_text: "Opportunity Cost", style_property: "background", style_value: "rgba(236, 72, 153, 0.1)")
✅ "make the Executive Summary section blue" → modify_specific_element(search_text: "Executive Summary", style_property: "background", style_value: "rgba(59, 130, 246, 0.1)")
✅ "change Cash Flow card border to red" → modify_specific_element(search_text: "Cash Flow", style_property: "border", style_value: "2px solid #ef4444")

BAR COLOR CHANGES (modify_bar_color):
✅ "change the orange bar of Opportunity Cost to pink" → modify_bar_color(search_text: "Opportunity Cost", new_color: "pink")
✅ "make the bar blue for Market Risk" → modify_bar_color(search_text: "Market Risk", new_color: "blue")

ADD ICONS (add_icon_to_card):
✅ "illustrate Present Value card" → add_icon_to_card(search_text: "Present Value", icon: "💰", position: "before_title")
✅ "illustrate this card: Market Risk" → add_icon_to_card(search_text: "Market Risk", icon: "⚠️", position: "before_title")
✅ "add emoji to Opportunity Cost" → add_icon_to_card(search_text: "Opportunity Cost", icon: "🎯", position: "before_title")
✅ "put icon on Cash Flow card" → add_icon_to_card(search_text: "Cash Flow", icon: "💵", position: "before_title")

DELETE CARD (delete_card):
✅ "delete card Present Value" → delete_card(search_text: "Present Value")
✅ "delete this card: Opportunity Cost" → delete_card(search_text: "Opportunity Cost")
✅ "remove the Market Risk card" → delete_card(search_text: "Market Risk")

RECREATE CARD (recreate_card):
✅ "recreate card Present Value" → recreate_card(search_text: "Present Value")
✅ "regenerate this card: Cash Flow" → recreate_card(search_text: "Cash Flow")
✅ "recreate Market Risk card with new title Investment Risk" → recreate_card(search_text: "Market Risk", new_title: "Investment Risk")

MOVE SECTION (move_section):
⚠️ CRITICAL: You MUST use the "Current sections" list provided at the end of this prompt to find section indices!

DETECTION RULES:
- User may or may not use the word "section" in their command
- If user says "move X after Y", look for section names X and Y in the Current sections list
- The word "section" is optional - "move Financial Markets after..." is valid

HOW TO CALCULATE INDICES:
⚠️ THE NUMBERS IN "Current sections" ARE THE ACTUAL section_index VALUES - USE THEM DIRECTLY!
⚠️ DO NOT subtract 1, DO NOT calculate - just use the number shown before the section name!

Step-by-step process:
1. Find the section name in the "Current sections" list below
2. Look at the NUMBER directly before that section name - that's the section_index
3. For "after Y": new_position = (number before Y) + 1
4. For "before Y": new_position = (number before Y)

EXAMPLES (generic):
If Current sections shows: "1. Section A, 2. Section B, 3. Section C, 4. Section D..."

✅ "move Section C after Section A":
   - Find "Section C" → it shows "3. Section C" → section_index is 3
   - Find "Section A" → it shows "1. Section A" → number is 1
   - After means +1 → new_position is 2
   - Answer: move_section(section_index: 3, new_position: 2)

✅ "move Section D after Section B":
   - Find "Section D" → it shows "4. Section D" → section_index is 4
   - Find "Section B" → it shows "2. Section B" → number is 2
   - After means +1 → new_position is 3
   - Answer: move_section(section_index: 4, new_position: 3)
Note: The word "section" is OPTIONAL in user commands. Always check the Current sections list below!

⚠️ ALWAYS check the "Current sections" list at the bottom of this message to get the correct current indices!

⚠️ IMPORTANT: You HAVE ACCESS to the original PDF document context. When recreating cards, the system will automatically use the PDF content to generate accurate information. Do NOT refuse to recreate cards - you have all the context needed.

Current sections: ${sections.map(s => `${s.index}. ${s.title}`).join(', ')}`
        },
        {
          role: 'user',
          content: message
        }
      ],
      tools: CHAT_TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const assistantMessage = response.data.choices[0].message;

    // DEBUG: Log what DeepSeek returned
    console.log('🤖 DeepSeek response:', JSON.stringify({
      tool_calls: assistantMessage.tool_calls,
      content: assistantMessage.content,
      finish_reason: response.data.choices[0].finish_reason
    }, null, 2));

    // No function calls → just a text response
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log('⚠️ DeepSeek returned TEXT instead of function call!');
      console.log('📝 Text response:', assistantMessage.content);
      return res.json({
        type: 'text_response',
        message: assistantMessage.content || "I can help you modify the report. Try asking me to change colors, add sections, or edit existing content."
      });
    }

    // Process function calls
    const results = [];
    for (const toolCall of assistantMessage.tool_calls) {
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      console.log(`📞 Function call: ${functionName}`, args);

      try {
        let result;
        switch (functionName) {
          case 'modify_colors':
            result = await handleColorChange(reportHtml, args);
            break;
          case 'add_section':
            result = await handleAddSection(reportHtml, args, pdfText);
            break;
          case 'modify_section':
            result = await handleModifySection(reportHtml, args, pdfText);
            break;
          case 'modify_fonts':
            result = await handleFontChange(reportHtml, args);
            break;
          case 'move_section':
            result = await handleMoveSection(reportHtml, args);
            break;
          case 'modify_specific_element':
            result = await handleModifySpecificElement(reportHtml, args);
            break;
          case 'modify_bar_color':
            result = await handleModifyBarColor(reportHtml, args);
            break;
          case 'add_icon_to_card':
            result = await handleAddIconToCard(reportHtml, args);
            break;
          case 'delete_card':
            result = await handleDeleteCard(reportHtml, args);
            break;
          case 'recreate_card':
            result = await handleRecreateCard(reportHtml, args, pdfText);
            break;
          default:
            result = { error: `Unknown function: ${functionName}` };
        }
        results.push(result);
      } catch (err) {
        console.error(`Error in ${functionName}:`, err);
        results.push({ error: err.message });
      }
    }

    // Return combined results
    const successfulChanges = results.filter(r => !r.error);
    if (successfulChanges.length === 0) {
      return res.json({
        type: 'error',
        message: 'Failed to apply changes: ' + results.map(r => r.error).join(', ')
      });
    }

    res.json({
      type: 'report_update',
      changes: successfulChanges,
      message: `✅ Applied ${successfulChanges.length} modification(s)`
    });

  } catch (error) {
    console.error('Chat edit error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error processing chat request',
      details: error.response?.data?.error || error.message
    });
  }
});

// 🎨 Handle color changes (instant, no AI)
async function handleColorChange(html, { primary_color, secondary_color }) {
  let newHtml = html;

  // 🔥 SMART COLOR DETECTION - Find ALL hex colors in the HTML automatically
  const hexColorRegex = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  const foundColors = new Set();
  let match;

  // Extract all unique colors from the HTML
  while ((match = hexColorRegex.exec(html)) !== null) {
    foundColors.add(match[0].toUpperCase());
  }

  console.log(`🔍 Found ${foundColors.size} unique colors in HTML:`, Array.from(foundColors));

  // Exclude black, white, and grayscale colors from replacement
  const excludedColors = new Set([
    '#FFFFFF', '#FFF', // White
    '#000000', '#000', // Black
    '#F8F9FA', '#F3F4F6', '#F1F3F5', '#E5E7EB', '#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#1F2937', '#111827', // Grays
    '#1E293B', '#64748B' // Slate grays (used for text)
  ]);

  let totalReplacements = 0;

  // Replace each found color (except excluded ones)
  for (const oldColor of foundColors) {
    // Skip if it's a gray/white/black color used for text or backgrounds
    if (excludedColors.has(oldColor.toUpperCase())) {
      console.log(`⏭️  Skipping ${oldColor} (excluded color)`);
      continue;
    }

    const regex = new RegExp(oldColor.replace('#', '\\#'), 'gi');
    const count = (newHtml.match(regex) || []).length;

    if (count > 0) {
      newHtml = newHtml.replace(regex, primary_color);
      totalReplacements += count;
      console.log(`🎨 Replaced ${oldColor} → ${primary_color} (${count} occurrences)`);
    }
  }

  console.log(`✅ Color replacement complete: ${totalReplacements} total replacements to ${primary_color}`);

  return {
    type: 'css_change',
    newHtml: newHtml,
    instant: true,
    message: `Changed ${totalReplacements} colors to ${primary_color}`
  };
}

// 🔤 Handle font changes (instant, no AI)
async function handleFontChange(html, { font_family, heading_size, body_size }) {
  let newHtml = html;
  let changesMade = [];

  console.log(`🔤 Changing fonts - family: ${font_family}, heading: ${heading_size || 'unchanged'}, body: ${body_size || 'unchanged'}`);

  // 1. Change font-family in style tags (<style> sections)
  if (font_family) {
    // Replace body font-family in <style> blocks
    const bodyFontRegex = /body\s*\{[^}]*font-family:\s*[^;]+;/gi;
    newHtml = newHtml.replace(bodyFontRegex, (match) => {
      return match.replace(/font-family:\s*[^;]+;/, `font-family: '${font_family}', sans-serif;`);
    });

    // Replace all font-family declarations in inline styles
    const inlineFontFamilyRegex = /font-family\s*:\s*[^;'"]+(?:['"][^'"]*['"])?\s*;?/gi;
    newHtml = newHtml.replace(inlineFontFamilyRegex, `font-family: '${font_family}', sans-serif;`);

    changesMade.push(`font-family: ${font_family}`);
  }

  // 2. Change heading sizes (h1, h2, etc.)
  if (heading_size) {
    // Replace h1 font-size in inline styles
    const h1FontSizeRegex = /<h1([^>]*style=["'])([^"']*)["']/gi;
    newHtml = newHtml.replace(h1FontSizeRegex, (match, p1, styleContent) => {
      const newStyle = styleContent.replace(/font-size:\s*[^;]+;?/, `font-size: ${heading_size};`);
      // If font-size wasn't found, add it
      if (!styleContent.includes('font-size')) {
        return `<h1${p1}${styleContent}; font-size: ${heading_size};"`;
      }
      return `<h1${p1}${newStyle}"`;
    });

    changesMade.push(`heading size: ${heading_size}`);
  }

  // 3. Change body text sizes (p, div text)
  if (body_size) {
    // Replace p font-size in inline styles
    const pFontSizeRegex = /<p([^>]*style=["'])([^"']*)["']/gi;
    newHtml = newHtml.replace(pFontSizeRegex, (match, p1, styleContent) => {
      const newStyle = styleContent.replace(/font-size:\s*[^;]+;?/, `font-size: ${body_size};`);
      // If font-size wasn't found, add it
      if (!styleContent.includes('font-size')) {
        return `<p${p1}${styleContent}; font-size: ${body_size};"`;
      }
      return `<p${p1}${newStyle}"`;
    });

    changesMade.push(`body size: ${body_size}`);
  }

  console.log(`✅ Font changes complete: ${changesMade.join(', ')}`);

  return {
    type: 'font_change',
    newHtml: newHtml,
    instant: true,
    message: `Changed fonts: ${changesMade.join(', ')}`
  };
}

// ➕ Handle adding new section
async function handleAddSection(html, { title, position, generate_content }, pdfText) {
  const $ = cheerio.load(html);
  const sections = $('section');

  // 🎨 EXTRACT DESIGN FROM EXISTING SECTIONS
  let extractedDesign = {
    colors: [],
    fonts: [],
    sectionStyle: '',
    headerStyle: '',
    textStyle: ''
  };

  if (sections.length > 0) {
    // Extract colors from all sections
    const colorRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
    sections.each((i, elem) => {
      const sectionHtml = $(elem).html();
      let match;
      while ((match = colorRegex.exec(sectionHtml)) !== null) {
        if (!extractedDesign.colors.includes(match[0])) {
          extractedDesign.colors.push(match[0]);
        }
      }
    });

    // Extract font families
    const firstSection = $(sections.get(0));
    const bodyText = firstSection.find('p').first();
    const heading = firstSection.find('h2').first();

    if (bodyText.length) {
      const style = bodyText.attr('style') || '';
      const fontMatch = style.match(/font-family:\s*([^;]+)/);
      if (fontMatch) extractedDesign.fonts.push(fontMatch[1]);
      extractedDesign.textStyle = style;
    }

    if (heading.length) {
      extractedDesign.headerStyle = heading.attr('style') || '';
    }

    // Get section wrapper style
    extractedDesign.sectionStyle = firstSection.attr('style') || 'padding:80px 0; border-bottom:1px solid rgba(59,130,246,0.1);';
  }

  console.log('🎨 Extracted design:', extractedDesign);

  let newSectionHtml;

  if (generate_content && pdfText) {
    // Generate content with AI - PRESERVE EXTRACTED DESIGN
    console.log(`🤖 Generating section content for: ${title}`);

    const designInstructions = `
🎨 CRITICAL: You MUST match the existing report design exactly!

Extracted Design Elements:
- Primary Colors: ${extractedDesign.colors.slice(0, 5).join(', ')}
- Section Style: ${extractedDesign.sectionStyle}
- Heading Style: ${extractedDesign.headerStyle}
- Text Style: ${extractedDesign.textStyle}

MANDATORY REQUIREMENTS:
1. Use ONLY the colors extracted above (especially ${extractedDesign.colors[0] || '#3b82f6'})
2. Match the exact section structure with icon circles, cards, badges
3. Copy the inline styles from existing sections
4. Include same visual elements: icon grids, colored backgrounds, gradients
5. Use the same fonts, sizes, and spacing as existing sections
`;

    const prompt = `${designInstructions}

Title: "${title}"
PDF Context (first 2000 chars): ${pdfText.substring(0, 2000)}

Generate ONLY ONE <section> that looks IDENTICAL to existing sections but with new content about "${title}".

Example structure you MUST follow:
<section style="${extractedDesign.sectionStyle}">
  <div class="section-header" style="display:flex; align-items:center; gap:16px; margin-bottom:40px;">
    <div style="font-size:2.5rem;">📊</div>
    <h2 style="${extractedDesign.headerStyle}">${title}</h2>
  </div>

  <!-- Add colorful cards, icon grids, metrics using colors: ${extractedDesign.colors.slice(0, 3).join(', ')} -->

  <div style="background:rgba(59,130,246,0.1); padding:24px; border-radius:16px; border:1px solid rgba(59,130,246,0.2);">
    <!-- Content with same visual style as existing sections -->
  </div>
</section>

Return ONLY the <section> HTML, nothing else.`;

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 3000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    newSectionHtml = response.data.choices[0].message.content.trim();

    // Clean up if AI added markdown code blocks
    newSectionHtml = newSectionHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '');
  } else {
    // Empty section template using extracted design
    const primaryColor = extractedDesign.colors[0] || '#3b82f6';
    newSectionHtml = `
      <section style="${extractedDesign.sectionStyle}">
        <div class="section-header" style="display:flex; align-items:center; gap:16px; margin-bottom:40px;">
          <div style="font-size:2.5rem;">✨</div>
          <h2 style="${extractedDesign.headerStyle || 'font-size:2rem; margin:0;'}">${title}</h2>
        </div>
        <p style="${extractedDesign.textStyle || 'font-size:1.1rem; line-height:1.8; color:#4b5563;'}">
          Content to be added...
        </p>
      </section>
    `;
  }

  // Insert at position
  if (position >= sections.length) {
    // Add before last section (usually conclusion)
    sections.last().before(newSectionHtml);
  } else {
    $(sections.get(position)).after(newSectionHtml);
  }

  return {
    type: 'section_added',
    newHtml: $.html(),
    message: `Added section "${title}" at position ${position}`
  };
}

// ✏️ Handle modifying existing section
async function handleModifySection(html, { section_index, action, additional_instructions }, pdfText) {
  const $ = cheerio.load(html);
  const sections = $('section');
  const section = $(sections.get(section_index));

  if (!section.length) {
    throw new Error(`Section ${section_index} not found`);
  }

  if (action === 'delete') {
    section.remove();
    return {
      type: 'section_deleted',
      newHtml: $.html(),
      message: `Deleted section ${section_index}`
    };
  }

  // For other actions, regenerate with AI
  const sectionHtml = section.html();
  const sectionTitle = section.find('h2').first().text().trim();

  const actionPrompts = {
    expand: 'Add more details, examples, and depth to this section. Make it 2-3x longer with additional insights.',
    summarize: 'Condense this section to its key points. Make it concise while preserving important information.',
    regenerate: 'Completely rewrite this section with fresh content and structure. Keep the same topic.'
  };

  const prompt = `${actionPrompts[action]}

Section title: "${sectionTitle}"
Current content: ${sectionHtml.substring(0, 1500)}
${additional_instructions ? `\nAdditional instructions: ${additional_instructions}` : ''}
${pdfText ? `\nPDF context: ${pdfText.substring(0, 2000)}` : ''}

Return ONLY the complete modified <section> HTML with inline styles. Maintain the same visual structure and styling.`;

  console.log(`🔄 ${action} section ${section_index}: ${sectionTitle}`);

  const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4000
  }, {
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  let newSectionHtml = response.data.choices[0].message.content.trim();
  newSectionHtml = newSectionHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '');

  section.replaceWith(newSectionHtml);

  return {
    type: 'section_modified',
    action: action,
    newHtml: $.html(),
    message: `${action.charAt(0).toUpperCase() + action.slice(1)}ed section "${sectionTitle}"`
  };
}

// 🎨 Handle modifying specific element by text search
async function handleModifySpecificElement(html, { search_text, style_property, style_value }) {
  const $ = cheerio.load(html);

  console.log(`🔍 Searching for element containing: "${search_text}"`);

  // Search strategy: Look for the text in multiple contexts
  let targetElement = null;
  let matchDescription = '';

  // 1. Try to find in card titles (h3)
  $('h3').each((i, elem) => {
    const text = $(elem).text().trim();
    if (text.toLowerCase().includes(search_text.toLowerCase())) {
      targetElement = $(elem).closest('.card, div[style*="background"]');
      matchDescription = `card with title "${text}"`;
      return false; // Break loop
    }
  });

  // 2. If not found, try h2 section headers
  if (!targetElement || targetElement.length === 0) {
    $('h2').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.toLowerCase().includes(search_text.toLowerCase())) {
        targetElement = $(elem).parent();
        matchDescription = `section header "${text}"`;
        return false;
      }
    });
  }

  // 3. If still not found, try any text content
  if (!targetElement || targetElement.length === 0) {
    $('*').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.includes(search_text) && text.length < 500) { // Not too long to avoid body
        targetElement = $(elem);
        matchDescription = `element containing "${search_text.substring(0, 30)}..."`;
        return false;
      }
    });
  }

  if (!targetElement || targetElement.length === 0) {
    throw new Error(`Could not find element containing text: "${search_text}"`);
  }

  // Get current style
  const currentStyle = targetElement.attr('style') || '';

  // Parse and modify style
  let newStyle = currentStyle;
  const propertyRegex = new RegExp(`${style_property}\\s*:\\s*[^;]+;?`, 'gi');

  if (propertyRegex.test(currentStyle)) {
    // Replace existing property
    newStyle = currentStyle.replace(propertyRegex, `${style_property}: ${style_value};`);
  } else {
    // Add new property
    newStyle = currentStyle.trim();
    if (newStyle && !newStyle.endsWith(';')) {
      newStyle += ';';
    }
    newStyle += ` ${style_property}: ${style_value};`;
  }

  // Apply new style
  targetElement.attr('style', newStyle);

  console.log(`✅ Modified ${matchDescription}: ${style_property} = ${style_value}`);

  return {
    type: 'element_modified',
    newHtml: $.html(),
    instant: true,
    message: `Modified ${matchDescription}: ${style_property} changed`
  };
}

// 🎨 Handle modifying bar/accent colors
async function handleModifyBarColor(html, { search_text, new_color }) {
  const $ = cheerio.load(html);

  console.log(`🔍 Searching for card with bar containing: "${search_text}"`);

  // Find the card by text
  let targetCard = null;
  let matchDescription = '';

  $('h3').each((i, elem) => {
    const text = $(elem).text().trim();
    if (text.toLowerCase().includes(search_text.toLowerCase())) {
      targetCard = $(elem).closest('.card, div[style*="background"]');
      matchDescription = `card "${text}"`;
      return false;
    }
  });

  if (!targetCard || targetCard.length === 0) {
    throw new Error(`Could not find card containing text: "${search_text}"`);
  }

  // Convert color name to hex if needed
  const colorMap = {
    'pink': '#ec4899',
    'light pink': 'rgba(236, 72, 153, 0.3)',
    'blue': '#3b82f6',
    'light blue': 'rgba(59, 130, 246, 0.3)',
    'green': '#10b981',
    'red': '#ef4444',
    'orange': '#f97316',
    'purple': '#a855f7',
    'yellow': '#eab308'
  };
  const finalColor = colorMap[new_color.toLowerCase()] || new_color;

  // Modify border-left (most common for bars)
  const currentStyle = targetCard.attr('style') || '';
  let newStyle = currentStyle;

  // Replace border-left-color or border-left
  if (/border-left/i.test(currentStyle)) {
    newStyle = currentStyle.replace(/border-left-color\s*:\s*[^;]+;?/gi, `border-left-color: ${finalColor};`);
    if (!/border-left-color/i.test(currentStyle)) {
      newStyle = currentStyle.replace(/border-left\s*:\s*[^;]+;?/gi, `border-left: 4px solid ${finalColor};`);
    }
  } else {
    // Add border-left if it doesn't exist
    newStyle = currentStyle.trim();
    if (newStyle && !newStyle.endsWith(';')) {
      newStyle += ';';
    }
    newStyle += ` border-left: 4px solid ${finalColor};`;
  }

  targetCard.attr('style', newStyle);

  console.log(`✅ Modified bar color for ${matchDescription}: ${finalColor}`);

  return {
    type: 'bar_modified',
    newHtml: $.html(),
    instant: true,
    message: `Changed bar color for ${matchDescription} to ${new_color}`
  };
}

// 🎯 Handle adding icon/emoji to card
async function handleAddIconToCard(html, { search_text, icon, position }) {
  const $ = cheerio.load(html);

  console.log(`🔍 Searching for card to add icon: "${search_text}"`);

  // Find the card by text
  let targetTitle = null;
  let matchDescription = '';

  $('h3').each((i, elem) => {
    const text = $(elem).text().trim();
    if (text.toLowerCase().includes(search_text.toLowerCase())) {
      targetTitle = $(elem);
      matchDescription = `"${text}"`;
      return false;
    }
  });

  if (!targetTitle || targetTitle.length === 0) {
    throw new Error(`Could not find card title containing text: "${search_text}"`);
  }

  // Add icon based on position
  const currentText = targetTitle.html();
  let newText;

  if (position === 'before_title') {
    newText = `${icon} ${currentText}`;
  } else {
    newText = `${currentText} ${icon}`;
  }

  targetTitle.html(newText);

  console.log(`✅ Added icon ${icon} to ${matchDescription}`);

  return {
    type: 'icon_added',
    newHtml: $.html(),
    instant: true,
    message: `Added ${icon} to card ${matchDescription}`
  };
}

// 🔍 INTELLIGENT CARD SEARCH - Find card with fuzzy matching
function findCardByText($, search_text) {
  const searchLower = search_text.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;
  let bestDescription = '';

  console.log(`🔍 Intelligent search for: "${search_text}"`);

  // Search in .card elements AND any div with h3 (more flexible)
  const candidates = [];

  // Strategy A: Look for .card elements
  $('.card').each((i, elem) => candidates.push($(elem)));

  // Strategy B: Look for divs with prominent h3/h2/h4 that might be card-like
  // IMPORTANT: Skip grid containers (grid-2, grid-3) - add their CHILDREN instead
  $('div').each((i, elem) => {
    const $div = $(elem);
    const divClasses = $div.attr('class') || '';

    // If it's a grid container, add its styled children as candidates
    if (divClasses.includes('grid-2') || divClasses.includes('grid-3')) {
      $div.children('div[style]').each((j, child) => {
        candidates.push($(child));
      });
      return; // Skip adding the grid container itself
    }

    // If it has a heading and is not already a .card
    if (!$div.hasClass('card') && ($div.find('h3').length > 0 || $div.find('h2').length > 0 || $div.find('h4').length > 0)) {
      candidates.push($div);
    }
  });

  // Strategy C: Look for divs with BIG styled text (font-size > 2rem) that might be titles
  $('div').each((i, elem) => {
    const $div = $(elem);
    if ($div.hasClass('card')) return; // Skip .card elements (already added)

    const divClasses = $div.attr('class') || '';
    // Skip grid containers - their children were already added in Strategy B
    if (divClasses.includes('grid-2') || divClasses.includes('grid-3')) return;

    // Check if this div has immediate children with large font-size in inline styles
    $div.children('div').each((j, child) => {
      const $child = $(child);
      const style = $child.attr('style') || '';
      // Look for font-size: 2rem or larger (e.g., "font-size:4rem", "font-size: 3rem")
      const fontSizeMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)(rem|px)/i);
      if (fontSizeMatch) {
        const size = parseFloat(fontSizeMatch[1]);
        const unit = fontSizeMatch[2];
        // If font-size >= 2rem OR >= 32px, consider it a title
        if ((unit === 'rem' && size >= 2) || (unit === 'px' && size >= 32)) {
          candidates.push($div);
          return false; // Break the .each loop
        }
      }
    });
  });

  console.log(`🔍 Found ${candidates.length} card-like elements to search`);

  candidates.forEach((item, i) => {
    const $card = item;

    // Get card title (h3, h2, h4, OR big styled div text - flexible)
    let title = '';
    // PRIORITY 1: Look for BIG styled text FIRST (most visually prominent)
    $card.children('div').each((j, child) => {
      const $child = $(child);
      const style = $child.attr('style') || '';
      const fontSizeMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)(rem|px)/i);
      if (fontSizeMatch) {
        const size = parseFloat(fontSizeMatch[1]);
        const unit = fontSizeMatch[2];
        if ((unit === 'rem' && size >= 2) || (unit === 'px' && size >= 32)) {
          const text = $child.text().trim();
          // Skip emojis or single characters - we want real text titles
          if (text.length > 2 && !/^[\u{1F300}-\u{1F9FF}]+$/u.test(text)) {
            title = text;
            return false; // Found title, break
          }
        }
      }
    });

    // PRIORITY 2: If no big styled text, fall back to headings
    if (!title) {
      const h3 = $card.find('h3').first();
      const h2 = $card.find('h2').first();
      const h4 = $card.find('h4').first();

      if (h3.length > 0) title = h3.text().trim();
      else if (h2.length > 0) title = h2.text().trim();
      else if (h4.length > 0) title = h4.text().trim();
    }

    if (!title) return; // Skip if no title found

    const titleLower = title.toLowerCase();

    // Get card content (all text)
    const fullText = $card.text().toLowerCase().replace(/\s+/g, ' ').trim();

    let score = 0;

    // Strategy 1: Exact match in title (highest priority)
    if (titleLower === searchLower) {
      score = 10000;
    }
    // Strategy 2: Title contains search text exactly (bonus if title length is close to search length)
    else if (titleLower.includes(searchLower)) {
      // Bonus: closer the length, higher the score
      const lengthDiff = Math.abs(titleLower.length - searchLower.length);
      const proximityBonus = Math.max(0, 500 - lengthDiff * 10);
      score = 500 + proximityBonus;
    }
    // Strategy 3: Search text contains title (user gave more details)
    else if (searchLower.includes(titleLower)) {
      score = 400;
    }
    // Strategy 4: Word-by-word matching in title
    else {
      const searchWords = searchLower.split(/\s+/);
      const titleWords = titleLower.split(/\s+/);
      const matchingWords = searchWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw)));
      score = matchingWords.length * 100;
    }

    // Strategy 5: Search in full card content (lower priority)
    if (score === 0 && fullText.includes(searchLower)) {
      score = 50;
    }

    // BONUS: If the main heading (not sub-headings) contains the search, boost score
    // This helps find the prominent "Present Value" title vs "Present Value Calculation"
    const firstHeading = $card.children().first();
    if (firstHeading.length > 0) {
      const headingText = firstHeading.text().toLowerCase().trim();
      if (headingText === searchLower) {
        score += 5000; // Big boost for main heading exact match
      } else if (headingText.includes(searchLower)) {
        score += 200; // Small boost for main heading contains
      }
    }

    console.log(`  Card "${title}": score ${score}`);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = $card;
      bestDescription = title;
    }
  });

  if (!bestMatch || bestScore === 0) {
    return null;
  }

  console.log(`✅ Best match: "${bestDescription}" (score: ${bestScore})`);
  return { card: bestMatch, title: bestDescription, score: bestScore };
}

// 🗑️ Handle deleting a card
async function handleDeleteCard(html, { search_text }) {
  const $ = cheerio.load(html);

  console.log(`🔍 Searching for card to delete: "${search_text}"`);

  const result = findCardByText($, search_text);

  if (!result) {
    throw new Error(`Could not find card containing text: "${search_text}"`);
  }

  // Remove the card
  result.card.remove();

  console.log(`✅ Deleted card "${result.title}"`);

  return {
    type: 'card_deleted',
    newHtml: $.html(),
    instant: true,
    message: `Deleted card "${result.title}"`
  };
}

// 🔄 Handle recreating a card with AI
async function handleRecreateCard(html, { search_text, new_title }, pdfText) {
  const $ = cheerio.load(html);

  console.log(`🔍 Searching for card to recreate: "${search_text}"`);

  const result = findCardByText($, search_text);

  if (!result) {
    throw new Error(`Could not find card containing text: "${search_text}"`);
  }

  let targetCard = result.card;
  const originalTitle = result.title;

  // Get card classes and styles to preserve design
  let cardClasses = targetCard.attr('class');
  let cardStyle = targetCard.attr('style') || '';
  let isGridContainer = false;

  // IMPORTANT: Check if targetCard is actually a grid container (grid-2, grid-3)
  // If so, we need to find the SPECIFIC styled child that contains our title
  if (cardClasses && (cardClasses.includes('grid-2') || cardClasses.includes('grid-3'))) {
    console.log('🔍 Found grid container, looking for the specific styled child card with title...');
    isGridContainer = true;

    // Find the styled child that contains the original title
    const styledChildren = targetCard.children('div[style]');
    styledChildren.each((i, child) => {
      const $child = $(child);
      const childText = $child.text();
      if (childText.includes(originalTitle)) {
        console.log('✨ Found the specific styled child card with matching title!');
        targetCard = $child; // CHANGE targetCard to the actual card, not the container
        cardStyle = $child.attr('style') || '';
        cardClasses = $child.attr('class') || ''; // Child usually has no class
        return false; // Break the loop
      }
    });
  }

  console.log('📦 Final card classes:', cardClasses);
  console.log('🎭 Final card style:', cardStyle);

  // Generate new content using AI
  const title = new_title || originalTitle;

  // Get the original card's inner HTML as a reference for styling
  const originalInnerHTML = targetCard.html();

  const prompt = `You are recreating a rich, visually styled financial report card. The card should match the design and complexity of the original.

ORIGINAL CARD HTML (for reference - match this level of detail and styling):
${originalInnerHTML}

TASK: Generate HTML content for a card with title "${title}" based on the PDF context below.

REQUIREMENTS:
- Return ONLY the inner HTML content (no outer <div>)
- Include h3 title with inline styles (margin, color)
- Add a large, bold, colored main text/value (font-size: 3rem or similar)
- Include supporting paragraphs with color styling (color: #64748b)
- Add visual elements like stats grids, badges, icons, or bullet lists if appropriate
- Use inline styles throughout (background gradients, padding, border-radius, borders)
- Match the visual richness and detail of the original card above
- Keep content relevant to the PDF context below

PDF Context:
${pdfText.substring(0, 4000)}`;

  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let newContent = response.data.choices[0].message.content.trim();
    console.log('🎨 DeepSeek raw response:', newContent);

    // Clean markdown code blocks (```html and ```)
    newContent = newContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');

    // Remove any explanatory text before the HTML (everything before first < tag)
    const firstTagIndex = newContent.indexOf('<');
    if (firstTagIndex > 0) {
      newContent = newContent.substring(firstTagIndex);
    }

    console.log('🧹 After cleaning:', newContent);

    // Create the new card with the same styling as the original
    let newCard;
    if (cardStyle) {
      // We have inline styles (the actual card from HTML), use them
      console.log('✨ Creating card with inline styles');
      newCard = $(`<div style="${cardStyle}">${newContent}</div>`);
    } else if (cardClasses) {
      // We have classes (old format), use them
      console.log('📦 Creating card with classes');
      newCard = $(`<div class="${cardClasses}">${newContent}</div>`);
    } else {
      // No styles found, use default .card class
      console.log('⚠️ No styles found, using default .card class');
      newCard = $(`<div class="card">${newContent}</div>`);
    }

    // Replace the targetCard with the new card
    // targetCard is now correctly pointing to the actual card div, not the container
    console.log('🔄 Replacing card...');
    targetCard.replaceWith(newCard);

    console.log(`✅ Recreated card "${originalTitle}"`);

    return {
      type: 'card_recreated',
      newHtml: $.html(),
      instant: false,
      message: `Recreated card with title "${title}"`
    };
  } catch (error) {
    console.error('Error recreating card:', error.message);
    throw new Error(`Failed to recreate card: ${error.message}`);
  }
}

// 🔄 Handle moving section to new position
async function handleMoveSection(html, { section_index, new_position }) {
  const $ = cheerio.load(html);
  const sections = $('section');

  if (section_index < 0 || section_index >= sections.length) {
    throw new Error(`Invalid section_index: ${section_index}. Report has ${sections.length} sections.`);
  }

  if (new_position < 0 || new_position >= sections.length) {
    throw new Error(`Invalid new_position: ${new_position}. Report has ${sections.length} sections.`);
  }

  if (section_index === new_position) {
    return {
      type: 'no_change',
      newHtml: html,
      message: 'Section already at that position'
    };
  }

  // Extract the section to move
  const sectionToMove = $(sections.get(section_index));
  const sectionTitle = sectionToMove.find('h2').first().text().trim();
  const sectionHtml = $.html(sectionToMove);

  console.log(`🔍 Moving section "${sectionTitle}" from index ${section_index} to ${new_position}`);

  // Remove it from current position
  sectionToMove.remove();

  // Re-query sections after removal
  const updatedSections = $('section');

  console.log(`📋 After removal, we have ${updatedSections.length} sections`);

  // 🔥 FIXED LOGIC: Insert at the target position
  // After removing the section, we need to adjust for the shift in indices
  // When moving FORWARD (section_index < new_position), the removal causes indices to shift down by 1
  // When moving BACKWARD (section_index > new_position), no adjustment needed

  let adjustedPosition = new_position;
  if (section_index < new_position) {
    // Moving forward: after removal, everything shifts down by 1
    adjustedPosition = new_position - 1;
    console.log(`📊 Moving forward: adjusted position from ${new_position} to ${adjustedPosition}`);
  }

  if (adjustedPosition === 0) {
    // Insert at the very beginning (before first section)
    console.log('📍 Inserting at the beginning');
    $(updatedSections.get(0)).before(sectionHtml);
  } else if (adjustedPosition >= updatedSections.length) {
    // Insert at the very end (after last section)
    console.log('📍 Inserting at the end');
    $(updatedSections.get(updatedSections.length - 1)).after(sectionHtml);
  } else {
    // Insert after the section at (adjustedPosition - 1)
    const insertAfterIndex = adjustedPosition - 1;
    console.log(`📍 Inserting after index ${insertAfterIndex} in the updated sections array`);
    $(updatedSections.get(insertAfterIndex)).after(sectionHtml);
  }

  console.log(`🔄 Moved section "${sectionTitle}" from position ${section_index} to ${new_position}`);

  return {
    type: 'section_moved',
    newHtml: $.html(),
    instant: true,
    message: `Moved "${sectionTitle}" from position ${section_index} to ${new_position}`
  };
}

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier PDF fourni' });
    }

    const data = await pdf(req.file.buffer);
    res.json({
      text: data.text,
      pages: data.numpages,
      info: data.info
    });
  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(500).json({ error: 'Error during PDF extraction' });
  }
});

app.post('/generate-report', async (req, res) => {
  try {
    const { pdfContent, fileName, reportType = 'professional' } = req.body;

    if (!pdfContent) {
      return res.status(400).json({ error: 'Aucun contenu PDF fourni' });
    }

    // ✅ FIX #3: Analyze document type for context-aware generation
    const documentProfile = analyzeDocumentType(pdfContent);
    const profileInstructions = getProfileInstructions(documentProfile);



    // ENGLISH PROMPT FOR DEEPSEEK - PROFESSIONAL HTML/CSS REPORT
    const adaptivePrompt = `You are an expert in creating professional HTML reports. Create a comprehensive report with clean HTML/CSS and styled divs.

${profileInstructions}

OBJECTIVE: Create a minimum 100KB document with COLORFUL, ILLUSTRATED design - less text, more color and visual elements! 🎨

🎯 DESIGN PHILOSOPHY: "MOINS DE CONTENU, PLUS DE COULEUR ET D'ILLUSTRATION"
- Replace white backgrounds with subtle colored backgrounds (rgba opacity)
- Add icon circles to every section header
- Use gradients everywhere (hero, cards, progress bars, charts)
- Display metrics as large colorful numbers with badges
- Create visual hierarchy with colors, not just typography
- Think presentation slides, not corporate documents!

🎯 LAYOUT REQUIREMENTS:
- ❌ FORBIDDEN: Centering content with max-width on container
- ✅ MANDATORY: Full-width layout - content must occupy entire viewport width
- Container: Remove max-width OR set to 100% with padding: 0 40px (NOT max-width: 1200px!)
- Sections should span full width with generous padding
- Example: .container { width: 100%; padding: 0 40px; margin: 0 auto; } (NO max-width!)

⚠️ ⚠️ ⚠️ CRITICAL HTML OUTPUT RULES:
1. EVERY piece of content MUST be wrapped in proper HTML tags (div, p, h3, span, etc.)
2. NEVER output plain text lines without HTML structure
3. If you want to show a list of items, ALWAYS use icon grid HTML structure
4. Test your HTML mentally - if you see bare text without tags, FIX IT immediately!
5. Start response with complete <!DOCTYPE html> tag and end with </body></html>

BASIC DESIGN ELEMENTS - Use only HTML/CSS with divs:

🎯 SIMPLE VISUALIZATIONS WITH DIVS:
- Progress bars with colored divs (width: %)
- Bar charts with divs of different heights
- Circular indicators with border-radius: 50%
- Classic HTML tables with CSS styles
- Metric boxes with colored backgrounds

🎯 COLORFUL & ILLUSTRATED DESIGN (MANDATORY):
- Colored card backgrounds with opacity: bg-primary/10, bg-blue-50, bg-gradient-to-br from-primary/10 to-primary/5
- Icons in colored circles: <div style="display:inline-flex; width:48px; height:48px; border-radius:12px; background:rgba(59,130,246,0.1); align-items:center; justify-content:center; color:#3b82f6; font-size:24px;">📊</div>
- Progress bars with gradients: background: linear-gradient(90deg, #9333ea 0%, #3b82f6 100%);
- Badges/pills for metrics: <span style="background:#3b82f6; color:white; padding:4px 12px; border-radius:12px; font-size:0.9rem;">Badge</span>
- Large colored numbers: <div style="font-size:3rem; font-weight:bold; color:#3b82f6; background:rgba(59,130,246,0.1); padding:20px; border-radius:16px;">89%</div>
- Colored borders on cards: border:1px solid rgba(59,130,246,0.2);
- Semantic color palette: primary(#3b82f6), success(#10b981), warning(#f59e0b), danger(#ef4444), purple(#9333ea), cyan(#06b6d4)

🎯 CLEAR STRUCTURE:
- Section headers with colored background
- Navigation with internal links
- Well-organized containers
- Harmonious borders and radius
- Hierarchical typography

🎯 VISUAL RICHNESS (LESS TEXT, MORE COLOR):
- Hero sections with gradients: <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; padding:60px 40px; border-radius:24px; text-align:center;">
- Icon grid displays: Multiple colored icon circles in a grid layout
- Animated progress bars: <div style="background:#f3f4f6; height:24px; border-radius:12px; overflow:hidden;"><div style="background:linear-gradient(90deg, #3b82f6, #06b6d4); height:100%; width:75%; animation:fillBar 1s ease-out;"></div></div>
- Metric cards with gradients: <div style="background:linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,51,234,0.05) 100%); padding:24px; border-radius:16px; border:1px solid rgba(59,130,246,0.2);">
- Badge clusters: Multiple colored pills grouped together
- Asymmetric layouts: Use CSS Grid with varying column sizes
- Large icon displays: Unicode emojis at 3-4rem size with colored backgrounds

🚨 CRITICAL RULES - COLORFUL FIRST GENERATION:

1. **HERO HEADER WITH GRADIENT (MANDATORY)**: Every report MUST start with a colorful hero section:
   - Gradient background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) or similar
   - White text on gradient with explicit color:white on h1
   - Large title with subtitle
   - Icon row or badge: <div style="display:flex; gap:16px; justify-content:center; margin-top:24px;"><div style="background:rgba(255,255,255,0.2); padding:12px 24px; border-radius:16px; color:white;">📊 Analysis</div></div>
   - Rounded corners (24px) and generous padding (60px 40px)
   - MANDATORY CSS: .section-header { display: flex; align-items: center; gap: 16px; margin-bottom: 40px; } - Icon and title MUST be left-aligned!

2. **COLORED CARDS EVERYWHERE - VARY COLORS**: Alternate card colors for visual variety:
   - ❌ FORBIDDEN: All cards with same blue color - MUST vary colors!
   - ✅ MANDATORY: Alternate between primary(blue), success(green), warning(orange), purple, cyan colors
   - First card: rgba(59,130,246,0.1) blue
   - Second card: rgba(16,185,129,0.1) green
   - Third card: rgba(245,158,11,0.1) orange
   - Fourth card: rgba(147,51,234,0.1) purple
   - Fifth card: rgba(6,182,212,0.1) cyan
   - Then repeat the cycle
   - Always match border color to background: border:1px solid rgba(SAME_COLOR,0.2);

3. **ICON CIRCLES IN EVERY SECTION**: Add visual icons to section headers:
   - Icon container: width:48px; height:48px; border-radius:12px; background:rgba(COLOR,0.1);
   - Center icon: display:inline-flex; align-items:center; justify-content:center;
   - Large emoji size: font-size:24px;

4. **BAR CHARTS WITH GRADIENTS**: Use gradient backgrounds instead of solid colors:
   - Progress bars: linear-gradient(90deg, #9333ea 0%, #3b82f6 100%);
   - Multi-color bars: Each bar gets different gradient (purple→blue, blue→cyan, green→emerald, orange→amber, red→rose)

5. **ADDITIONAL VISUAL PATTERNS** (use frequently):
   - Hover effects on cards: transform: translateY(-4px); box-shadow for interactivity
   - Stylized bullet lists: Replace standard bullets with colored dots (6px circles)
   - Percentage circles: 80px circles with border + percentage inside (Quality/Delivery/Budget style)
   - Alert boxes: Gradient backgrounds with thick left border (4px) and emoji icons
   - Stats grids: 3-4 metrics in grid layout with large numbers and colored backgrounds
   - Asymmetric layouts: 2-column grids with 2fr/1fr ratio for main/side content

6. **ILLUSTRATIONS OBLIGATOIRES** (remplacer texte par visuel):
   - ❌ ❌ ❌ ABSOLUMENT INTERDIT: Écrire du texte en liste simple comme "Real Assets\nSecurities\nContracts" sans structure HTML visuelle!
   - ❌ ❌ ❌ ABSOLUMENT INTERDIT: Laisser du texte brut sans mise en forme HTML (ex: juste "📈\nValuation Expertise\nReal Assets\nSecurities")
   - ❌ INTERDIT: Laisser du texte simple sans illustration visuelle
   - ❌ INTERDIT: Laisser des espaces vides entre titre et contenu
   - ❌ INTERDIT: Cards avec seulement texte en haut et badges en bas - REMPLIR LE MILIEU!
   - ❌ INTERDIT: Paragraphes de texte brut - TOUJOURS utiliser icon grids, circles, badges, progress bars
   - ✅ OBLIGATOIRE: Chaque ligne de texte DOIT être dans un élément HTML visuel (div, badge, circle, card)
   - ✅ OBLIGATOIRE: Si vous voyez "Item 1\nItem 2\nItem 3", créer un ICON GRID avec 3 cercles colorés!
   - ✅ OBLIGATOIRE: Entre titre et texte, ajouter TOUJOURS une illustration (icon grid, flow diagram, metric showcase)
   - Grid d'icônes colorées: 3-4 cercles d'icônes en ligne pour illustrer des concepts
   - Diagrammes de flux: Flèches et étapes numérotées avec cercles colorés
   - Metric showcases: Grands chiffres colorés avec icônes et descriptions courtes
   - Visual hierarchies: Utiliser taille, couleur et position pour créer du sens visuel
   - RÈGLE D'OR: "Moins de contenu, plus de couleur et d'illustration" - privilégier TOUJOURS le visuel au texte
   - REMPLISSAGE: Chaque card doit être PLEINE d'éléments visuels - icon grids, circles, progress bars, badges, metrics

   🚨 EXEMPLE DE CE QU'IL NE FAUT JAMAIS FAIRE:
   ❌ MAUVAIS (texte brut):
   <div class="card">
     <h3>Valuation Expertise</h3>
     Real Assets
     Securities
     Contracts
   </div>

   ✅ BON (icon grid visuel):
   <div class="card">
     <h3>Valuation Expertise</h3>
     <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; margin:24px 0;">
       <div style="text-align:center;">
         <div style="background:rgba(59,130,246,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">🏢</div>
         <h4>Real Assets</h4>
       </div>
       <div style="text-align:center;">
         <div style="background:rgba(16,185,129,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">📊</div>
         <h4>Securities</h4>
       </div>
       <div style="text-align:center;">
         <div style="background:rgba(245,158,11,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">📄</div>
         <h4>Contracts</h4>
       </div>
     </div>
   </div>

COLORFUL TECHNICAL EXAMPLES (MANDATORY PATTERNS):

✅ **HERO GRADIENT HEADER** (ENHANCED DESIGN):
<div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; padding:80px 60px; border-radius:0; text-align:center; margin-bottom:40px; position:relative; overflow:hidden; box-shadow:0 8px 32px rgba(118,75,162,0.3);">
  <!-- Decorative circles -->
  <div style="position:absolute; top:-50px; right:-50px; width:200px; height:200px; border-radius:50%; background:rgba(255,255,255,0.1);"></div>
  <div style="position:absolute; bottom:-80px; left:-80px; width:250px; height:250px; border-radius:50%; background:rgba(255,255,255,0.08);"></div>
  <div style="position:absolute; top:50%; left:10%; width:100px; height:100px; border-radius:50%; background:rgba(255,255,255,0.06);"></div>

  <!-- Content wrapper -->
  <div style="position:relative; z-index:1;">
    <div style="display:inline-block; background:rgba(255,255,255,0.15); padding:8px 20px; border-radius:20px; font-size:0.85rem; font-weight:600; margin-bottom:20px; letter-spacing:1px; text-transform:uppercase;">Professional Analysis</div>
    <h1 style="font-size:3.5rem; margin:0 0 20px 0; color:white; font-weight:700; letter-spacing:-1px; text-shadow:0 2px 20px rgba(0,0,0,0.2);">Report Title</h1>
    <p style="font-size:1.3rem; color:white; opacity:1; margin:0 auto; max-width:700px; line-height:1.6;">Subtitle describing the report content and objectives</p>
    <div style="display:flex; gap:12px; justify-content:center; margin-top:32px; flex-wrap:wrap;">
      <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px;"><span style="font-size:1.1rem;">📊</span>Analysis</div>
      <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px;"><span style="font-size:1.1rem;">💼</span>Strategy</div>
      <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px;"><span style="font-size:1.1rem;">📈</span>Insights</div>
    </div>
  </div>
</div>

✅ **COLORED METRIC CARD** (vary colors - blue example):
<div style="background:linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,51,234,0.05) 100%); padding:24px; border-radius:16px; border:1px solid rgba(59,130,246,0.2); margin:16px 0;">
  <div style="display:inline-flex; width:48px; height:48px; border-radius:12px; background:rgba(59,130,246,0.15); align-items:center; justify-content:center; font-size:24px; margin-bottom:16px;">📊</div>
  <h3 style="margin:8px 0; color:#1e293b;">Metric Title</h3>
  <div style="font-size:3rem; font-weight:bold; color:#3b82f6; margin:16px 0;">89%</div>
  <p style="color:#64748b; margin:0;">Description text</p>
</div>

✅ **GREEN CARD VARIANT** (alternate colors):
<div style="background:rgba(16,185,129,0.1); padding:24px; border-radius:16px; border:1px solid rgba(16,185,129,0.2); margin:16px 0;">
  <div style="display:inline-flex; width:48px; height:48px; border-radius:12px; background:rgba(16,185,129,0.15); align-items:center; justify-content:center; font-size:24px; margin-bottom:16px;">✓</div>
  <h3 style="margin:8px 0; color:#1e293b;">Success Metric</h3>
  <div style="font-size:3rem; font-weight:bold; color:#10b981; margin:16px 0;">95%</div>
</div>

✅ **ORANGE CARD VARIANT**:
<div style="background:rgba(245,158,11,0.1); padding:24px; border-radius:16px; border:1px solid rgba(245,158,11,0.2); margin:16px 0;">
  <div style="display:inline-flex; width:48px; height:48px; border-radius:12px; background:rgba(245,158,11,0.15); align-items:center; justify-content:center; font-size:24px; margin-bottom:16px;">⚠️</div>
  <h3 style="margin:8px 0; color:#1e293b;">Warning Metric</h3>
  <div style="font-size:3rem; font-weight:bold; color:#f59e0b; margin:16px 0;">78%</div>
</div>

✅ **PURPLE CARD VARIANT**:
<div style="background:rgba(147,51,234,0.1); padding:24px; border-radius:16px; border:1px solid rgba(147,51,234,0.2); margin:16px 0;">
  <div style="display:inline-flex; width:48px; height:48px; border-radius:12px; background:rgba(147,51,234,0.15); align-items:center; justify-content:center; font-size:24px; margin-bottom:16px;">🎯</div>
  <h3 style="margin:8px 0; color:#1e293b;">Strategic Metric</h3>
  <div style="font-size:3rem; font-weight:bold; color:#9333ea; margin:16px 0;">92%</div>
</div>

✅ **GRADIENT PROGRESS BAR**:
<div style="background:#f3f4f6; height:24px; border-radius:12px; overflow:hidden; margin:16px 0;">
  <div style="background:linear-gradient(90deg, #9333ea 0%, #3b82f6 100%); height:100%; width:75%; transition:width 1s ease-out;"></div>
</div>

✅ **ICON CIRCLE + TEXT**:
<div style="display:flex; align-items:center; gap:16px; margin:16px 0;">
  <div style="display:inline-flex; width:56px; height:56px; border-radius:14px; background:rgba(16,185,129,0.1); align-items:center; justify-content:center; color:#10b981; font-size:28px; flex-shrink:0;">✓</div>
  <div>
    <h4 style="margin:0; color:#1e293b;">Success Metric</h4>
    <p style="margin:4px 0 0 0; color:#64748b; font-size:0.9rem;">Details here</p>
  </div>
</div>

✅ **BADGE CLUSTER**:
<div style="display:flex; gap:8px; flex-wrap:wrap; margin:16px 0;">
  <span style="background:#3b82f6; color:white; padding:6px 16px; border-radius:12px; font-size:0.9rem;">Primary</span>
  <span style="background:#10b981; color:white; padding:6px 16px; border-radius:12px; font-size:0.9rem;">Success</span>
  <span style="background:#f59e0b; color:white; padding:6px 16px; border-radius:12px; font-size:0.9rem;">Warning</span>
</div>

✅ **GRADIENT BAR CHART** (each bar different gradient):
<div style="display:flex; align-items:end; height:200px; gap:15px; padding-bottom:70px; justify-content:space-around;">
  <div style="position:relative; flex:1; max-width:80px;"><div style="background:linear-gradient(180deg, #9333ea, #3b82f6); height:80%; width:100%; border-radius:8px 8px 0 0;"></div><div style="position:absolute; bottom:-40px; width:100%; text-align:center; font-size:0.8rem;">Label 1</div></div>
  <div style="position:relative; flex:1; max-width:80px;"><div style="background:linear-gradient(180deg, #3b82f6, #06b6d4); height:65%; width:100%; border-radius:8px 0 0;"></div><div style="position:absolute; bottom:-40px; width:100%; text-align:center; font-size:0.8rem;">Label 2</div></div>
  <div style="position:relative; flex:1; max-width:80px;"><div style="background:linear-gradient(180deg, #10b981, #059669); height:90%; width:100%; border-radius:8px 8px 0 0;"></div><div style="position:absolute; bottom:-40px; width:100%; text-align:center; font-size:0.8rem;">Label 3</div></div>
</div>

✅ **HOVER CARDS WITH SHADOW**:
<div style="background:linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,51,234,0.05) 100%); padding:24px; border-radius:16px; border:1px solid rgba(59,130,246,0.2); transition:transform 0.2s, box-shadow 0.2s; cursor:pointer;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 12px 24px rgba(59,130,246,0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
  Content here
</div>

✅ **STYLIZED BULLET LIST** (colored dots):
<ul style="list-style:none; padding:0; margin:16px 0;">
  <li style="display:flex; align-items:start; gap:12px; margin:12px 0;">
    <div style="width:6px; height:6px; border-radius:50%; background:#3b82f6; margin-top:8px; flex-shrink:0;"></div>
    <span>List item text here</span>
  </li>
  <li style="display:flex; align-items:start; gap:12px; margin:12px 0;">
    <div style="width:6px; height:6px; border-radius:50%; background:#10b981; margin-top:8px; flex-shrink:0;"></div>
    <span>Another item</span>
  </li>
</ul>

✅ **PERCENTAGE CIRCLES** (Quality/Delivery/Budget style):
<div style="display:flex; gap:24px; justify-content:center; margin:32px 0;">
  <div style="text-align:center;">
    <div style="width:80px; height:80px; border-radius:50%; background:rgba(59,130,246,0.1); display:flex; align-items:center; justify-content:center; border:4px solid #3b82f6; margin:0 auto;">
      <span style="font-size:1.5rem; font-weight:bold; color:#3b82f6;">95%</span>
    </div>
    <p style="margin-top:12px; font-weight:600; color:#1e293b;">Quality</p>
  </div>
  <div style="text-align:center;">
    <div style="width:80px; height:80px; border-radius:50%; background:rgba(16,185,129,0.1); display:flex; align-items:center; justify-content:center; border:4px solid #10b981; margin:0 auto;">
      <span style="font-size:1.5rem; font-weight:bold; color:#10b981;">88%</span>
    </div>
    <p style="margin-top:12px; font-weight:600; color:#1e293b;">Delivery</p>
  </div>
  <div style="text-align:center;">
    <div style="width:80px; height:80px; border-radius:50%; background:rgba(245,158,11,0.1); display:flex; align-items:center; justify-content:center; border:4px solid #f59e0b; margin:0 auto;">
      <span style="font-size:1.5rem; font-weight:bold; color:#f59e0b;">92%</span>
    </div>
    <p style="margin-top:12px; font-weight:600; color:#1e293b;">Budget</p>
  </div>
</div>

✅ **ALERT BOX** (gradient background + colored border):
<div style="background:linear-gradient(90deg, rgba(239,68,68,0.1) 0%, rgba(245,158,11,0.1) 100%); border:1px solid rgba(239,68,68,0.2); border-left:4px solid #ef4444; padding:16px 20px; border-radius:12px; margin:16px 0;">
  <div style="display:flex; align-items:center; gap:12px;">
    <span style="font-size:1.5rem;">⚠️</span>
    <div>
      <h4 style="margin:0; color:#991b1b; font-size:1rem;">Alert Title</h4>
      <p style="margin:4px 0 0 0; color:#64748b; font-size:0.9rem;">Alert message details here</p>
    </div>
  </div>
</div>

✅ **STATS GRID** (3-4 metrics side by side):
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin:24px 0;">
  <div style="background:rgba(59,130,246,0.1); padding:20px; border-radius:12px; border:1px solid rgba(59,130,246,0.2); text-align:center;">
    <div style="font-size:2.5rem; font-weight:bold; color:#3b82f6;">1,234</div>
    <p style="margin:8px 0 0 0; color:#64748b; font-size:0.9rem;">Total Users</p>
  </div>
  <div style="background:rgba(16,185,129,0.1); padding:20px; border-radius:12px; border:1px solid rgba(16,185,129,0.2); text-align:center;">
    <div style="font-size:2.5rem; font-weight:bold; color:#10b981;">89%</div>
    <p style="margin:8px 0 0 0; color:#64748b; font-size:0.9rem;">Success Rate</p>
  </div>
  <div style="background:rgba(245,158,11,0.1); padding:20px; border-radius:12px; border:1px solid rgba(245,158,11,0.2); text-align:center;">
    <div style="font-size:2.5rem; font-weight:bold; color:#f59e0b;">24h</div>
    <p style="margin:8px 0 0 0; color:#64748b; font-size:0.9rem;">Avg Response</p>
  </div>
</div>

✅ **ASYMMETRIC 2-COLUMN GRID** (60/40 or 70/30 split):
<div style="display:grid; grid-template-columns:2fr 1fr; gap:24px; margin:24px 0;">
  <div style="background:rgba(59,130,246,0.05); padding:24px; border-radius:16px;">
    <h3>Main Content (larger column)</h3>
    <p>Content here takes more space...</p>
  </div>
  <div style="background:rgba(147,51,234,0.05); padding:24px; border-radius:16px;">
    <h3>Side Info</h3>
    <p>Smaller column...</p>
  </div>
</div>

✅ **ICON GRID** (illustrate concepts visually):
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:20px; margin:24px 0;">
  <div style="text-align:center;">
    <div style="background:rgba(59,130,246,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">📊</div>
    <h4 style="margin:8px 0; font-size:1rem;">Concept 1</h4>
    <p style="margin:0; font-size:0.85rem; color:#64748b;">Brief description</p>
  </div>
  <div style="text-align:center;">
    <div style="background:rgba(16,185,129,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">✓</div>
    <h4 style="margin:8px 0; font-size:1rem;">Concept 2</h4>
    <p style="margin:0; font-size:0.85rem; color:#64748b;">Brief description</p>
  </div>
  <div style="text-align:center;">
    <div style="background:rgba(245,158,11,0.1); width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:32px;">🎯</div>
    <h4 style="margin:8px 0; font-size:1rem;">Concept 3</h4>
    <p style="margin:0; font-size:0.85rem; color:#64748b;">Brief description</p>
  </div>
</div>

✅ **FLOW DIAGRAM** (step by step with arrows):
<div style="background:linear-gradient(135deg, rgba(59,130,246,0.05) 0%, rgba(147,51,234,0.05) 100%); padding:32px; border-radius:16px; margin:24px 0;">
  <div style="display:flex; align-items:center; justify-content:space-around; flex-wrap:wrap; gap:16px;">
    <div style="text-align:center;">
      <div style="background:#3b82f6; color:white; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px; font-size:24px; font-weight:bold;">1</div>
      <p style="margin:0; font-weight:600; max-width:120px;">First Step</p>
    </div>
    <div style="font-size:28px; color:#3b82f6;">→</div>
    <div style="text-align:center;">
      <div style="background:#10b981; color:white; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px; font-size:24px; font-weight:bold;">2</div>
      <p style="margin:0; font-weight:600; max-width:120px;">Second Step</p>
    </div>
    <div style="font-size:28px; color:#10b981;">→</div>
    <div style="text-align:center;">
      <div style="background:#f59e0b; color:white; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px; font-size:24px; font-weight:bold;">3</div>
      <p style="margin:0; font-weight:600; max-width:120px;">Third Step</p>
    </div>
  </div>
</div>

✅ **METRIC SHOWCASE** (large visual emphasis):
<div style="text-align:center; background:linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,51,234,0.05) 100%); padding:40px; border-radius:20px; margin:24px 0;">
  <div style="display:inline-flex; width:80px; height:80px; border-radius:50%; background:rgba(59,130,246,0.2); align-items:center; justify-content:center; font-size:40px; margin-bottom:20px;">📈</div>
  <div style="font-size:4rem; font-weight:bold; color:#3b82f6; margin:16px 0;">$2.5M</div>
  <h3 style="margin:12px 0; color:#1e293b;">Total Market Value</h3>
  <p style="margin:0; color:#64748b; max-width:400px; margin:0 auto;">Comprehensive market valuation based on discounted cash flow analysis</p>
</div>
- OPTIMIZED Navigation: <nav style="background:#f8f9fa; padding:10px; border-bottom:2px solid #007bff;"><ul style="display:flex; white-space:nowrap; overflow-x:auto; flex-wrap:nowrap; list-style:none; margin:0; padding:0; gap:12px; scrollbar-width:thin;">
- 🚨 ULTRA-CRITICAL: Links MUST be ≤5 chars to fit 8 sections without scrollbar! Increase gap to 12px for better spacing!
- ✅ CORRECT EXAMPLE (8 links, NO SCROLLBAR):
  <a href="#exec">Exec</a> <a href="#def">Def</a> <a href="#eval">Eval</a> <a href="#market">Market</a> <a href="#obj">Obj</a> <a href="#flow">Flow</a> <a href="#risk">Risk</a> <a href="#concl">Concl</a>
- ❌ FORBIDDEN: "Executive Summary" (17 chars), "Finance Definition" (18 chars), "Asset Valuation" (15 chars) - CAUSES HORIZONTAL SCROLL!
- MANDATORY ABBREVIATIONS: "Executive Summary"→"Exec", "Overview"→"Intro", "Definition"→"Def", "Asset Valuation"→"Eval", "Financial Markets"→"Market", "Manager Objectives"→"Obj", "Cash Flow"→"Flow", "Risk Assessment"→"Risk", "Conclusions"→"Concl"
- ANTI-WRAP CSS: nav ul { display: flex !important; flex-wrap: nowrap !important; white-space: nowrap !important; overflow-x: auto !important; }
- ADVANCED SMOOTH SCROLLING: html { scroll-behavior: smooth; scroll-padding-top: 80px; }
- ✅ SECTION SPACING: section { padding: 80px 0; border-bottom: 1px solid rgba(59, 130, 246, 0.1); } - Large vertical spacing between sections for better readability
- 🚨 CRITICAL HERO SPACING: #hero { margin-bottom: 80px !important; } - MANDATORY gap after hero section to prevent touching next section
- SCROLL CSS ANIMATIONS: @keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
- FADE-IN ON SCROLL: .fade-in { animation: fadeInUp 0.8s ease-out; } .slide-in-left { animation: slideInLeft 0.6s ease-out; } .slide-in-right { animation: slideInRight 0.6s ease-out; }
- SLIDE KEYFRAMES: @keyframes slideInLeft { from { opacity: 0; transform: translateX(-50px); } to { opacity: 1; transform: translateX(0); } } @keyframes slideInRight { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: translateX(0); } }
- Mobile responsive: @media (max-width: 768px) { nav a { padding: 6px 8px !important; font-size: 0.8rem !important; } }
- HAMBURGER MENU mobile: @media (max-width: 768px) { .nav-toggle { display: block; } .nav-menu { display: none; position: absolute; top: 100%; left: 0; width: 100%; background: #007bff; flex-direction: column; } .nav-menu.active { display: flex; } }
- HAMBURGER BUTTON: <button class="nav-toggle" style="display:none; background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;" onclick="document.querySelector('.nav-menu').classList.toggle('active')">☰</button>
- PARALLAX HEADER: .parallax-header { background-attachment: fixed; background-position: center; background-repeat: no-repeat; background-size: cover; }
- PROGRESS BAR: .progress-bar-reading { position: fixed; top: 0; left: 0; width: 0%; height: 4px; background: linear-gradient(90deg, #007bff, #0056b3); z-index: 9999; transition: width 0.3s ease; }
- INTERSECTION OBSERVER: <script>const observer = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('fade-in'); } }); }); document.querySelectorAll('section, .card').forEach(el => observer.observe(el));</script>

⚠️ CRITICAL RULES FOR CONTENT:
- DO NOT invent numerical data, metrics, or statistics
- DO NOT add fake dates like "Updated Q4 2024" unless explicitly in the PDF
- Use ONLY information directly extracted from the PDF content
- For visualizations, use CONCEPTUAL illustrations (icons, diagrams) rather than charts with fake data
- If you need to show a chart, use abstract/proportional representations without specific numbers

Use your full power for CONTENT, push your limits, you have 64K tokens.

BEFORE STARTING: Organize your battle plan by listing your strategy for the PROFESSIONAL DESIGN and IMPACTFUL CONTENT you will create! DEPLOY ALL YOUR POWER on in-depth PDF analysis!

🎨 CRITICAL DESIGN REQUIREMENTS (COLORFUL FIRST GENERATION):
- ✅ MANDATORY: Hero gradient header at the top (no plain white headers!)
- ✅ MANDATORY: Every card must have colored background (rgba with opacity)
- ✅ MANDATORY: Icon circles in section headers (48px circles with emoji icons)
- ✅ MANDATORY: Progress bars and charts with gradients (not solid colors)
- ✅ MANDATORY: Large colored metric numbers (3rem font size, colored backgrounds)
- ✅ MANDATORY: Colored badges/pills for categories and highlights
- ✅ MANDATORY: Replace plain text with visual illustrations (icon grids, flow diagrams, metric showcases)
- ✅ MANDATORY: VARY card colors - alternate blue, green, orange, purple, cyan (NEVER all blue!)
- ✅ MANDATORY: FILL cards completely - add icon grids, metrics, circles, progress bars between title and badges
- ❌ FORBIDDEN: Leaving plain text without visual representation - ALWAYS add icons, circles, or diagrams
- ❌ FORBIDDEN: Empty space without visual elements - fill with colored backgrounds, icons, or illustrations
- ❌ FORBIDDEN: All cards same color - MUST alternate colors for visual variety!
- Functional internal navigation (links to sections with IDs)
- Rich content and in-depth PDF analysis (100KB minimum)
- NO complex JavaScript - Internal links navigation only
- Semantic color palette: primary(#3b82f6), success(#10b981), warning(#f59e0b), danger(#ef4444), purple(#9333ea), cyan(#06b6d4)
- Responsive design with CSS Grid/Flexbox
- RULE: Every section must have visual elements (icon grids, flow diagrams, percentage circles, or metric showcases) - NO plain text sections!

🔖 **PPT CONVERSION MEMOS (ULTRA-CRITICAL FOR SLIDE GENERATION):**
- ✅ MANDATORY: Add a memo comment BEFORE each <section> tag to guide PPT conversion
- ✅ MANDATORY: Use format: <!-- PPT_SECTION: Section Title Here -->
- ✅ MANDATORY: Each section MUST have unique ID attribute: <section id="unique-id" class="container fade-in">
- ✅ Example structure (without backticks):

  Comment: PPT_SECTION: Executive Summary
  Then: section id="exec" class="container fade-in"
    ... section content ...
  Close: /section

  Comment: PPT_SECTION: Market Analysis
  Then: section id="market" class="container fade-in"
    ... section content ...
  Close: /section

- These memos are INVISIBLE in the browser but will guide automatic PPT slide extraction
- The PPT converter will read these memos and extract each section into individual slides
- This makes the system UNIVERSAL: works for Finance PDFs, Geology PDFs, Marketing PDFs, ANY topic!

PDF TO ANALYZE:
${pdfContent}

Start with <!DOCTYPE html> and NOW DEPLOY ALL YOUR POWER on every element of your plan! NO LIMITS, NO COMPROMISES - this is YOUR COMPETITION to win!`;

    const response = await retryAPICall(async () => {
      const deepSeekResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: adaptivePrompt }],
        max_tokens: 64000,
        temperature: 1.5
      }, {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 300000, // 5 minutes timeout for DeepSeek
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return { content: [{ text: deepSeekResponse.data.choices[0].message.content }] };
    });

    let reportContent = response.content[0].text;

    // DEBUG: Verify raw DeepSeek content
    console.log('=== DEBUG DEEPSEEK ===');
    console.log('Raw length:', reportContent ? reportContent.length : 0);
    console.log('First 500 chars:', reportContent ? reportContent.substring(0, 500) : 'EMPTY');
    console.log('======================');

    if (!reportContent || reportContent.trim().length === 0) {
      console.error('DeepSeek returned empty content!');
      return res.status(500).json({
        error: 'DeepSeek generated no content. Please try again.'
      });
    }

    // Clean HTML content
    reportContent = cleanHtmlOutput(reportContent);

    console.log('=== AFTER CLEANING ===');
    console.log('Cleaned length:', reportContent.length);
    console.log('=======================');

    res.json({
      reportHtml: reportContent,
      fileName: fileName ? `${fileName.replace('.pdf', '')}-report.html` : 'professional-report.html'
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Error during report generation' });
  }
});




// PHASE 5: Visual enhancement with DeepSeek (self-critique continuation)
app.post('/api/enhance-report', async (req, res) => {
  // 🚫 PHASE 5 DISABLED - Return Phase 4 HTML directly without enhancement
  const { reportHtml } = req.body;

  console.log('⚠️ Phase 5 DISABLED - Returning original Phase 4 HTML');
  return res.json({
    enhancedHtml: reportHtml,
    phase5Disabled: true,
    message: 'Phase 5 enhancement skipped - using clean Phase 4 output'
  });
});


// PHASE 3: Presentation conversion (HYBRID JS APPROACH - NO AI)
app.post('/api/convert-to-presentation', async (req, res) => {
  try {
    const { reportHtml, fileName } = req.body;

    if (!reportHtml) {
      return res.status(400).json({ error: 'Missing HTML report' });
    }

    console.log('🎯 PHASE 3: Hybrid PPT conversion (JS parsing + templating)');

    // Utiliser la fonction hybride de parsing/génération
    const presentationHtml = generatePresentationHTML(reportHtml, fileName);

    console.log('✅ PPT généré avec succès (copie exacte des sections)');

    res.json({
      presentationHtml: presentationHtml,
      fileName: fileName ? `${fileName.replace('.html', '')}-presentation.html` : 'presentation.html',
      method: 'hybrid-js-parsing'
    });

  } catch (error) {
    console.error('Phase 3 Error:', error);
    res.status(503).json({ error: 'Conversion error: ' + error.message });
  }
});

// PHASE 3 OLD (AI-BASED) - DISABLED FOR TESTING
app.post('/api/convert-to-presentation-old-ai', async (req, res) => {
  try {
    const { reportHtml, fileName } = req.body;

    if (!reportHtml) {
      return res.status(400).json({ error: 'Missing HTML report' });
    }

    const conversionPrompt = `🎯 UNIVERSAL PPT CONVERTER: Extract sections using PPT_SECTION memos and create slides

FULL SOURCE HTML WITH PPT MEMOS:
${reportHtml}

📋 **YOUR MISSION (AUTOMATED SECTION EXTRACTION):**

The source HTML contains special memo comments that mark each section for PPT conversion:

Example format:
- Comment line: PPT_SECTION: Executive Summary
- Following tag: section id="exec" class="container fade-in"
- Content
- Closing tag: /section

- Comment line: PPT_SECTION: Market Analysis
- Following tag: section id="market" class="container fade-in"
- Content
- Closing tag: /section

**STEP-BY-STEP PROCESS:**

1️⃣ **SCAN FOR PPT MEMOS:**
   - Find ALL comments matching: <!-- PPT_SECTION: ... -->
   - Extract the section title from each memo
   - Note the section ID from the following <section> tag

2️⃣ **EXTRACT SECTION CONTENT:**
   - For each PPT_SECTION memo found, extract the ENTIRE <section>...</section> content
   - DO NOT modify, recreate, or simplify - COPY EXACTLY AS IS
   - Keep ALL inner HTML: section-header, cards, icon-grids, badges, colors, everything

3️⃣ **CREATE SLIDES:**
   - Slide 0: Title slide (hero gradient + SVG)
   - Slide 1: Table of Contents (list all PPT_SECTION titles found)
   - Slide 2+: One slide per section (paste extracted content)

🚨 **CRITICAL EXTRACTION RULES:**

✅ **CORRECT APPROACH:**
1. Read HTML and find: <!-- PPT_SECTION: Executive Summary -->
2. Extract the next <section id="exec">...</section> block COMPLETELY
3. Paste into: <div class="slide" id="slide-2"><div style="padding:40px; overflow-y:auto; height:100%;">PASTE HERE</div></div>
4. Repeat for ALL PPT_SECTION memos found

❌ **WRONG APPROACH:**
- ❌ Generating new content instead of copying sections
- ❌ Recreating cards/grids from scratch
- ❌ Simplifying complex layouts
- ❌ Removing visual elements
- ❌ Making generic business slides

**UNIVERSAL EXAMPLE (Works for ANY topic):**

If you find in the source HTML a comment "PPT_SECTION: Geological Formations" followed by a section with icon-circle, section-header, cards, icon-grids, etc., you MUST copy ALL that HTML content into a slide wrapper. Do NOT recreate or simplify - just copy paste the entire section inner HTML.

**SLIDE 0: Title Slide**
- Extract title from report (usually in hero section or <title> tag)
- Hero gradient background
- Colorful SVG illustration (theme-related)

**SLIDE 1: Table of Contents**
- 2-column grid
- Create one card per PPT_SECTION memo found
- Use section titles from memos
- Number badges: 01, 02, 03...
- Colored cards: blue → green → orange → purple → cyan
- Make cards clickable (data-slide attribute)

**NAVIGATION & UI:**

**Top Navigation Bar:**
- Background: linear-gradient(90deg, #1e40af 0%, #3b82f6 100%)
- Links: Home, Contents, + one link per section
- Previous/Next buttons

**Slide Indicators:**
- Position: bottom: 60px
- Circles with active state

**Progress Bar:**
- Position: top: 72px
- Width updates based on current slide

**KEYBOARD NAVIGATION:**
- Arrow Right / Space: Next slide
- Arrow Left: Previous slide

**CSS STRUCTURE:**
\`\`\`css
body { overflow: hidden; }
.presentation { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
.presentation-nav { /* top bar */ }
.slides-container { flex: 1; position: relative; overflow: hidden; }
.slide { position: absolute; width: 100%; height: 100%; opacity: 0; }
.slide:not(.active) { transform: translateX(-100%); }
.slide.active { opacity: 1; transform: translateX(0); }
.slide-indicators { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); }
.progress-bar { position: fixed; top: 72px; left: 0; width: 100%; height: 5px; }
\`\`\`

⚠️ ⚠️ ⚠️ ULTRA-CRITICAL - ANIMATION FIX:
❌ ❌ ❌ ABSOLUTELY FORBIDDEN: Adding ANY inline style with transform or opacity on slide divs!
❌ WRONG EXAMPLE (breaks animations):
  <div class="slide" id="slide-0" style="transform: translateX(-100%);">
  <div class="slide" id="slide-1" style="transform: translateX(-100%); opacity: 1;">

✅ ✅ ✅ CORRECT WAY:
  <div class="slide active" id="slide-0">  <!-- First slide gets "active" class -->
  <div class="slide" id="slide-1">  <!-- Other slides get NO class, NO inline styles -->
  <div class="slide" id="slide-2">

The CSS handles ALL animations via .slide:not(.active) and .slide.active selectors.
JavaScript handles transform changes dynamically.
NEVER write style="transform:..." or style="opacity:..." on slide divs!

**JAVASCRIPT ANIMATION LOGIC:**
\`\`\`javascript
function goToSlide(slideIndex) {
  const direction = slideIndex > currentSlide ? 1 : -1;

  // Hide current slide
  slides[currentSlide].style.transform = direction > 0 ? 'translateX(-100%)' : 'translateX(100%)';
  slides[currentSlide].classList.remove('active');

  // Show new slide
  slides[slideIndex].style.transform = 'translateX(0)';
  slides[slideIndex].classList.add('active');
  slides[slideIndex].style.opacity = '1';

  currentSlide = slideIndex;
}
\`\`\`

⚠️ ANIMATION DIRECTION:
- Next slide (→): New slide comes from RIGHT (translateX(100%) → translateX(0))
- Previous slide (←): New slide comes from LEFT (translateX(-100%) → translateX(0))
- Current slide exits in OPPOSITE direction of new slide entry

⚠️ CRITICAL:
- Nav gap MUST be 30px to avoid scrollbar
- Slide indicators MUST be at bottom: 60px (visible!)
- Progress bar MUST be just below nav (NOT at page bottom!)
- SLIDE 1 MUST have colorful SVG illustration below title (400x300px, themed to report content)
- SLIDE 2 MUST be table of contents/summary with rich CSS (2-column grid, gradient cards, number badges, hover effects)
- Maintain ALL visual elements from original (colored cards, icons, metrics, etc.)

📐 SVG ILLUSTRATION EXAMPLES FOR SLIDE 1:

**Finance/Business Theme:**
<svg width="400" height="300" viewBox="0 0 400 300" style="margin:40px auto; display:block;">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <!-- Chart bars -->
  <rect x="50" y="180" width="60" height="100" rx="8" fill="url(#grad1)" opacity="0.9"/>
  <rect x="130" y="140" width="60" height="140" rx="8" fill="#10b981" opacity="0.9"/>
  <rect x="210" y="100" width="60" height="180" rx="8" fill="#f59e0b" opacity="0.9"/>
  <rect x="290" y="60" width="60" height="220" rx="8" fill="#ef4444" opacity="0.9"/>
  <!-- Trend line -->
  <polyline points="80,200 160,160 240,120 320,80" stroke="#fff" stroke-width="4" fill="none" opacity="0.8"/>
  <!-- Circles on trend line -->
  <circle cx="80" cy="200" r="8" fill="#fff"/>
  <circle cx="160" cy="160" r="8" fill="#fff"/>
  <circle cx="240" cy="120" r="8" fill="#fff"/>
  <circle cx="320" cy="80" r="8" fill="#fff"/>
</svg>

**Tech/DevOps Theme:**
<svg width="400" height="300" viewBox="0 0 400 300" style="margin:40px auto; display:block;">
  <!-- Pipeline flow -->
  <circle cx="80" cy="150" r="40" fill="#3b82f6" opacity="0.9"/>
  <rect x="130" y="140" width="60" height="20" rx="10" fill="#10b981" opacity="0.8"/>
  <circle cx="230" cy="150" r="40" fill="#f59e0b" opacity="0.9"/>
  <rect x="280" y="140" width="60" height="20" rx="10" fill="#8b5cf6" opacity="0.8"/>
  <!-- Gears -->
  <path d="M 80 130 L 90 140 L 80 150 L 70 140 Z" fill="#fff" opacity="0.7"/>
  <path d="M 230 130 L 240 140 L 230 150 L 220 140 Z" fill="#fff" opacity="0.7"/>
</svg>

**Marketing/Analytics Theme:**
<svg width="400" height="300" viewBox="0 0 400 300" style="margin:40px auto; display:block;">
  <!-- Pie chart -->
  <circle cx="150" cy="150" r="80" fill="#3b82f6" opacity="0.9"/>
  <path d="M 150 150 L 230 150 A 80 80 0 0 1 150 70 Z" fill="#10b981" opacity="0.9"/>
  <path d="M 150 150 L 150 70 A 80 80 0 0 1 195 100 Z" fill="#f59e0b" opacity="0.9"/>
  <!-- Growth arrow -->
  <polyline points="260,200 280,180 300,160 320,140" stroke="#8b5cf6" stroke-width="6" fill="none"/>
  <polygon points="320,140 310,145 315,155" fill="#8b5cf6"/>
</svg>

Start with <!DOCTYPE html> and create a complete presentation!`;

    const response = await retryAPICall(async () => {
      const deepSeekResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: conversionPrompt }],
        max_tokens: 64000,
        temperature: 1.5
      }, {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      return { content: [{ text: deepSeekResponse.data.choices[0].message.content }] };
    });

    let presentationHtml = cleanHtmlOutput(response.content[0].text);

    res.json({
      presentationHtml: presentationHtml,
      fileName: fileName ? `${fileName.replace('.html', '')}-presentation.html` : 'presentation.html'
    });

  } catch (error) {
    console.error('Phase 2 Error:', error);
    res.status(503).json({ error: 'Conversion error' });
  }
});

// Utility function for retry with backoff
async function retryAPICall(apiFunction, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiFunction();
    } catch (error) {
      const isRetriable =
        error.status === 529 || // API overload
        error.code === 'ECONNRESET' || // Connection reset
        error.code === 'ETIMEDOUT' || // Timeout
        error.code === 'ECONNABORTED' || // Connection aborted
        error.message?.includes('aborted'); // Axios abort

      if (isRetriable && attempt < maxRetries - 1) {
        const waitTime = (attempt + 1) * 3000;
        console.log(`⚠️ API error (${error.code || error.status}), retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.error(`❌ API call failed after ${attempt + 1} attempts:`, error.message);
        throw error;
      }
    }
  }
}

// Enhanced HTML cleaning function
function cleanHtmlOutput(content) {
  // Remove markdown code blocks
  content = content.replace(/```html\s*/gi, '').replace(/```\s*$/g, '');
  content = content.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '');

  // Remove markdown headers at the beginning
  content = content.replace(/^#+[^\n]*\n*/gm, '');

  // Remove markdown dashes
  content = content.replace(/^-+\s*/gm, '');

  // Extract only valid HTML
  const htmlMatch = content.match(/<!DOCTYPE html>[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    content = htmlMatch[0];
  } else {
    // Search for just <html>
    const htmlStart = content.match(/<html[^>]*>[\s\S]*?<\/html>/i);
    if (htmlStart) {
      content = '<!DOCTYPE html>\n' + htmlStart[0];
    } else {
      // If no HTML structure found, wrap it
      content = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>DeepSeek Report</title>\n</head>\n<body>\n${content}\n</body>\n</html>`;
    }
  }

  return content;
}

// 🪝 Removed Stripe endpoints - payments will be configured separately

app.listen(port, () => {
  console.log(`\n🚀 DocGenius - Commercial Beta`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Landing Page: http://localhost:${port}/`);
  console.log(`🎯 Application:  http://localhost:${port}/app`);
  console.log(`💰 Pricing:      http://localhost:${port}/pricing`);
  console.log(`🔐 Auth:         http://localhost:${port}/auth`);
  console.log(`📈 Dashboard:    http://localhost:${port}/dashboard`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(``);
});