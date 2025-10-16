// ✅ FIX #3: Document Profiles - Intelligent context detection
// Detects document type and applies appropriate styling rules

const profiles = {
  academic: {
    keywords: ['theorem', 'proof', 'lemma', 'bibliography', 'citation', 'abstract', 'methodology', 'hypothesis', 'research', 'study', 'analysis', 'equation', 'formula'],
    weight: 0,
    config: {
      emojis: false,
      mathJax: true,
      svgStyle: 'minimal',
      colorScheme: 'monochrome',
      tone: 'formal',
      citations: true
    }
  },

  business: {
    keywords: ['quarterly', 'revenue', 'stakeholder', 'KPI', 'fiscal', 'profit', 'analysis', 'market', 'strategy', 'financial', 'budget', 'ROI', 'investment'],
    weight: 0,
    config: {
      emojis: false,
      mathJax: false,
      svgStyle: 'corporate',
      colorScheme: 'blue-professional',
      tone: 'professional',
      charts: 'business-style'
    }
  },

  tutorial: {
    keywords: ['step', 'how to', 'guide', 'learn', 'tutorial', 'beginner', 'example', 'introduction', 'getting started', 'lesson'],
    weight: 0,
    config: {
      emojis: true,      // ✅ Emojis allowed in tutorials
      mathJax: false,
      svgStyle: 'friendly',
      colorScheme: 'vibrant',
      tone: 'casual',
      navigation: 'step-by-step'
    }
  },

  legal: {
    keywords: ['whereas', 'herein', 'plaintiff', 'defendant', 'article', 'statute', 'jurisdiction', 'contract', 'agreement', 'law', 'regulation', 'clause'],
    weight: 0,
    config: {
      emojis: false,     // ❌ NO emojis in legal docs!
      mathJax: false,
      svgStyle: 'none',  // ❌ NO illustrations in legal docs
      colorScheme: 'strict-monochrome',
      tone: 'strict-formal',
      formatting: 'preserve-exact'
    }
  }
};

/**
 * Analyze document content and determine its type
 * @param {string} content - The PDF text content
 * @returns {Object} - { type, confidence, config }
 */
function analyzeDocumentType(content) {
  if (!content || content.trim().length === 0) {
    console.warn('⚠️ Empty content for document analysis, defaulting to business profile');
    return {
      type: 'business',
      confidence: 0,
      config: profiles.business.config
    };
  }

  const words = content.toLowerCase().split(/\s+/);
  const profilesCopy = JSON.parse(JSON.stringify(profiles)); // Deep copy

  // Calculate weight for each profile based on keyword matches
  for (let [profileName, profile] of Object.entries(profilesCopy)) {
    profile.weight = profile.keywords.filter(kw =>
      words.some(w => w.includes(kw.toLowerCase()))
    ).length;
  }

  // Find the profile with highest weight
  const sortedProfiles = Object.entries(profilesCopy)
    .sort(([, a], [, b]) => b.weight - a.weight);

  const winner = sortedProfiles[0];
  const winnerName = winner[0];
  const winnerProfile = winner[1];
  const confidence = winnerProfile.weight / winnerProfile.keywords.length;

  console.log(`📊 Document Analysis Results:`);
  console.log(`   - Type: ${winnerName}`);
  console.log(`   - Confidence: ${Math.round(confidence * 100)}%`);
  console.log(`   - Matched keywords: ${winnerProfile.weight}/${winnerProfile.keywords.length}`);

  // Show all profile scores
  sortedProfiles.forEach(([name, profile]) => {
    console.log(`   - ${name}: ${profile.weight} matches`);
  });

  return {
    type: winnerName,
    confidence: confidence,
    config: winnerProfile.config
  };
}

/**
 * Generate prompt instructions based on document profile
 * @param {Object} profile - The detected profile
 * @returns {string} - Formatted instructions for the AI
 */
function getProfileInstructions(profile) {
  const config = profile.config;

  let instructions = `
📋 DOCUMENT PROFILE DETECTED: ${profile.type.toUpperCase()} (${Math.round(profile.confidence * 100)}% confidence)

⚙️ APPLY THESE RULES:
`;

  if (!config.emojis) {
    instructions += `❌ EMOJIS: FORBIDDEN - This is a ${profile.type} document, use professional icons only\n`;
  } else {
    instructions += `✅ EMOJIS: Allowed - Use tastefully to enhance readability\n`;
  }

  if (config.mathJax) {
    instructions += `📐 MATH RENDERING: Required - Include MathJax for LaTeX formulas\n`;
  }

  instructions += `🎨 SVG STYLE: ${config.svgStyle}\n`;
  instructions += `🎨 COLOR SCHEME: ${config.colorScheme}\n`;
  instructions += `📝 TONE: ${config.tone}\n`;

  if (config.svgStyle === 'none') {
    instructions += `\n⚠️ CRITICAL: NO SVG illustrations for this document type. Focus on clean text formatting only.\n`;
  }

  if (config.svgStyle === 'minimal') {
    instructions += `\n⚠️ SVG LIMIT: Maximum 3-4 simple icons only. No decorative charts.\n`;
  }

  return instructions;
}

module.exports = {
  analyzeDocumentType,
  getProfileInstructions,
  profiles
};
