const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

// Configuration
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Vérification de la clé API
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERREUR: ANTHROPIC_API_KEY manquante dans les variables d\'environnement');
}

// Initialisation Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'missing-api-key',
});

// Initialisation OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key',
});

// Configuration multer pour uploads (stockage en mémoire pour Vercel)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  }
});

// Fonction utilitaire pour retry avec backoff
async function retryAPICall(apiFunction, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await apiFunction();
      return result;
    } catch (error) {
      console.error(`Tentative ${attempt + 1} échouée:`, error.message);

      if (error.status === 529 || error.message?.includes('overloaded')) {
        const waitTime = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.log(`API surchargée, attente de ${waitTime}ms avant retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (attempt === maxRetries - 1) {
        throw error;
      } else {
        const waitTime = 2000 * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
}

// Route pour upload et extraction PDF
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier PDF fourni' });
    }

    const dataBuffer = req.file.buffer;
    const data = await pdfParse(dataBuffer);

    res.json({
      text: data.text,
      pages: data.numpages,
      info: data.info
    });
  } catch (error) {
    console.error('Erreur extraction PDF:', error);
    res.status(500).json({ error: 'Erreur lors de l\'extraction du PDF' });
  }
});

// PHASE 1: Analyse du PDF
app.post('/api/analyze-pdf', async (req, res) => {
  try {
    const { pdfContent } = req.body;

    if (!pdfContent) {
      return res.status(400).json({ error: 'Contenu PDF manquant' });
    }

    const domainAnalysisPrompt = `Tu es un expert analyste de documents techniques. Tu dois faire une ANALYSE ULTRA-DÉTAILLÉE de ce contenu PDF.

CONTENU COMPLET DU PDF:
${pdfContent}

INSTRUCTIONS CRITIQUES - ANALYSE APPROFONDIE:

1. LIS TOUT LE CONTENU avec attention maximale
2. EXTRAIS tous les détails spécifiques, exemples, formules, diagrammes mentionnés
3. IDENTIFIE les concepts précis, les chiffres exacts, les noms propres
4. CAPTURE la structure pédagogique et les exemples concrets
5. NOTE tous les acronymes, références bibliographiques, cours/institutions

RÉSULTAT ATTENDU - ANALYSE STRUCTURÉE:

**DOMAINE:** [cybersecurite/finance/technique/commercial/rh/juridique/medical/educatif/autre]

**TITRE PRÉCIS:** [Titre exact basé sur le contenu réel]

**INSTITUTION/COURS:** [Si applicable: nom université, numéro cours, professeur]

**STRUCTURE DÉTAILLÉE:**
- Sections principales avec leurs sous-parties
- Concepts clés avec définitions exactes
- Formules et exemples numériques précis
- Diagrammes et schémas décrits

**EXEMPLES CONCRETS EXTRAITS:**
- Tous les exemples pratiques avec chiffres exacts
- Études de cas mentionnées
- Exercices ou problèmes proposés

**VOCABULAIRE SPÉCIALISÉ:**
- Termes techniques spécifiques au domaine
- Acronymes et abréviations utilisées
- Références à d'autres travaux/auteurs

**CONTEXTE PÉDAGOGIQUE:**
- Type de document (cours, manuel, recherche, etc.)
- Niveau d'étude visé
- Objectifs d'apprentissage

IMPÉRATIF: Ton analyse doit être si détaillée qu'un expert du domaine puisse reconnaître EXACTEMENT ce document spécifique parmi des milliers d'autres !`;

    const response = await retryAPICall(async () => {
      return await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 4000,
        messages: [{ role: 'user', content: domainAnalysisPrompt }]
      });
    });

    const analysisText = response.content[0].text;

    res.json({
      analysis: analysisText,
      phase: 1,
      message: 'Analyse du domaine complétée'
    });

  } catch (error) {
    console.error('Erreur Phase 1:', error);
    res.status(503).json({
      error: 'Erreur lors de l\'analyse - API surchargée',
      retry: true,
      phase: 1
    });
  }
});

// PHASE 2: Génération du rapport basé sur l'analyse
app.post('/api/generate-report-structure', async (req, res) => {
  try {
    // Vérifier la clé API
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'missing-api-key') {
      console.error('API Key manquante pour Phase 2');
      return res.status(500).json({
        error: 'Configuration serveur incomplète - Clé API Anthropic manquante. Veuillez configurer ANTHROPIC_API_KEY dans les variables d\'environnement Vercel.',
        phase: 2
      });
    }

    const { analysis, fileName, reportType = 'intervention' } = req.body;

    if (!analysis) {
      return res.status(400).json({ error: 'Analyse manquante' });
    }

    // Template spécialisé selon le type de rapport
    const reportTemplates = {
      intervention: {
        title: "RAPPORT D'INTERVENTION TECHNIQUE",
        focus: "intervention technique détaillée",
        sections: ["Résumé Exécutif", "Contexte d'Intervention", "Analyse Technique", "Actions Réalisées", "Résultats et Métriques", "Recommandations", "Plan de Suivi"],
        visualizations: ["Timeline d'intervention", "Graphiques de performance avant/après", "Diagrammes techniques", "Métriques de résolution"]
      },
      academique: {
        title: "RAPPORT D'ANALYSE ACADÉMIQUE",
        focus: "étude académique approfondie avec méthodologie rigoureuse",
        sections: ["Abstract", "Introduction", "Méthodologie", "Analyse des Données", "Résultats", "Discussion", "Conclusion", "Références"],
        visualizations: ["Graphiques statistiques", "Tableaux de corrélation", "Diagrammes méthodologiques", "Analyses comparatives"]
      },
      executif: {
        title: "RAPPORT EXÉCUTIF STRATÉGIQUE",
        focus: "synthèse exécutive orientée décision avec KPIs",
        sections: ["Synthèse Stratégique", "Enjeux Clés", "Analyse d'Impact", "Opportunités", "Risques", "Recommandations Stratégiques", "Plan d'Action"],
        visualizations: ["Dashboard exécutif", "Matrices stratégiques", "Graphiques ROI", "Tableaux de bord KPIs"]
      }
    };

    const template = reportTemplates[reportType];

    const reportPrompt = `Crée un rapport HTML ULTRA-PROFESSIONNEL de type "${template.title}" avec de nombreux éléments visuels basé sur cette analyse DÉTAILLÉE:

ANALYSE APPROFONDIE DU DOCUMENT:
${analysis}

DIRECTIVE SPÉCIALE: Utilise TOUS les détails spécifiques de l'analyse ci-dessus - exemples numériques exacts, formules précises, noms propres, institutions, références. Le rapport doit refléter EXACTEMENT le contenu analysé, pas des généralités.

TYPE DE RAPPORT: ${template.focus.toUpperCase()}
SECTIONS REQUISES: ${template.sections.join(', ')}

INSTRUCTIONS CRITIQUES - RAPPORT DE NIVEAU CONSEIL:
1. INCLUS OBLIGATOIREMENT ces éléments visuels SIMPLES:
   - ${template.visualizations.join('\n   - ')}
   - Graphiques en barres avec divs colorées (height: X%)
   - Tableaux HTML classiques avec styles hover
   - Diagrammes avec divs positionnées et connectées
   - Matrices colorées avec divs et background colors
   - Dashboards avec boîtes de métriques stylées
   - Boîtes statistiques avec divs et icônes Unicode
   - Graphiques en barres avec divs flex
   - Progress bars avec divs imbriquées

2. STYLES CSS AVANCÉS OBLIGATOIRES:
   - Gradients dans les headers adaptés au type ${reportType}
   - Ombres et effets de profondeur
   - Animations et transitions CSS
   - Responsive design complet
   - Couleurs professionnelles cohérentes selon le contexte

3. STRUCTURE ENRICHIE SPÉCIALISÉE:
   - Header avec titre "${template.title}" et métadonnées
   - Table des matières cliquable OBLIGATOIREMENT sur UNE SEULE LIGNE (flex, nowrap, overflow-x)
   - Navigation avec liens courts pour éviter les sauts de ligne
   - Sections détaillées: ${template.sections.join(', ')}
   - Visualisations dans CHAQUE section
   - Boîtes d'alerte colorées adaptées au contexte
   - Résumé avec statistiques pertinentes
   - Annexes spécialisées

4. CONTENU RICHE ADAPTÉ AU TYPE ${reportType.toUpperCase()}:
   - Minimum 6-8 sections détaillées selon le template
   - 3-5 visualisations avec divs colorées minimum
   - 2-3 tableaux HTML avec données contextualisées
   - Métriques et KPIs avec boîtes colorées adaptés
   - Citations et références selon le type

5. EXEMPLES DE VISUALISATIONS SIMPLES À UTILISER:
   - Barre de progression: <div style="background:#eee; height:20px; border-radius:10px;"><div style="background:#007bff; width:75%; height:100%; border-radius:10px;"></div></div>
   - Graphique barres SANS CHEVAUCHEMENT: <div style="display:flex; align-items:end; height:150px; gap:15px; padding-bottom:50px; justify-content:space-around;">
   - Barre individuelle avec label: <div style="position:relative; flex:1; max-width:80px;"><div style="background:#007bff; height:80%; width:100%; border-radius:4px 4px 0 0;"></div><div style="position:absolute; bottom:-40px; width:100%; text-align:center; font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Label</div></div>
   - Métrique: <div style="background:#f8f9fa; padding:20px; border-left:5px solid #007bff; margin:10px 0;"><h3>85%</h3><p>Taux de réussite</p></div>
   - Indicateur: <div style="display:inline-block; width:20px; height:20px; background:#28a745; border-radius:50%; margin-right:10px;"></div>
   - Card: <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 15px rgba(0,0,0,0.1); margin:15px 0;"></div>

6. NAVIGATION HEADER ULTRA-OPTIMISÉE:
   - STRUCTURE FIXE OBLIGATOIRE: <nav><ul style="display:flex; white-space:nowrap; overflow-x:auto; flex-wrap:nowrap; list-style:none; margin:0; padding:0; gap:8px; scrollbar-width:thin;">
   - LIENS COURTS OBLIGATOIRES (max 6 chars): <a href="#intro">Intro</a> <a href="#def">Déf</a> <a href="#eval">Eval</a> <a href="#flux">Flux</a> <a href="#march">March</a> <a href="#obj">Obj</a> <a href="#concl">Concl</a>
   - CSS ANTI-WRAP CRITIQUE: nav ul { display: flex !important; flex-wrap: nowrap !important; white-space: nowrap !important; overflow-x: auto !important; }
   - RESPONSIVE MOBILE: @media (max-width: 768px) { nav a { padding: 6px 8px !important; font-size: 0.8rem !important; } }
   - SCROLL horizontal stylé avec scrollbar-thumb si débordement
   - JAMAIS PLUS DE 8 LIENS maximum dans la navigation
   - RACCOURCISSEMENT AUTO : Si section > 6 chars, utiliser abréviations intelligentes
   - DICTIONNAIRE ABRÉV : Introduction→Intro, Définition→Déf, Évaluation→Eval, Analyse→Ana, Méthodologie→Méth, Discussion→Disc, Conclusion→Concl, Recommandations→Reco
   - MENU HAMBURGER mobile avec bouton ☰ et CSS responsive complet

7. ANIMATIONS SCROLL SMOOTH AVANCÉES:
   - SMOOTH SCROLLING : html { scroll-behavior: smooth; scroll-padding-top: 80px; }
   - ANIMATIONS FADE-IN : @keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
   - CLASSES ANIMATION : .fade-in { animation: fadeInUp 0.8s ease-out; } .slide-in-left { animation: slideInLeft 0.6s ease-out; } .slide-in-right { animation: slideInRight 0.6s ease-out; }
   - SLIDES DIRECTIONNELLES : @keyframes slideInLeft { from { opacity: 0; transform: translateX(-50px); } to { opacity: 1; transform: translateX(0); } } @keyframes slideInRight { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: translateX(0); } }
   - PARALLAX HEADER : .parallax-header { background-attachment: fixed; background-position: center; background-repeat: no-repeat; background-size: cover; }
   - BARRE PROGRESSION LECTURE : <div class="progress-bar-reading"></div> avec CSS : .progress-bar-reading { position: fixed; top: 0; left: 0; width: 0%; height: 4px; background: linear-gradient(90deg, #007bff, #0056b3); z-index: 9999; transition: width 0.3s ease; }
   - INTERSECTION OBSERVER : <script>const observer = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('fade-in'); } }); }); document.querySelectorAll('section, .card').forEach(el => observer.observe(el));</script>
   - PROGRESSION SCROLL : window.addEventListener('scroll', () => { const scrolled = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100; document.querySelector('.progress-bar-reading').style.width = scrolled + '%'; });

EXIGENCES CRITIQUES - GÉNÉRATION COMPLÈTE OBLIGATOIRE:
- GÉNÈRE IMPÉRATIVEMENT TOUTES LES ${template.sections.length} SECTIONS : ${template.sections.join(', ')}
- CHAQUE SECTION DOIT ÊTRE COMPLÈTEMENT DÉVELOPPÉE (minimum 200-400 mots par section)
- AUCUNE TRONCATURE AUTORISÉE - Le rapport DOIT se terminer par "</html>"
- Taille minimale: 35-50kb pour assurer toutes les sections
- Au moins 2-3 visualisations (SVG/graphiques) par section majeure
- Toutes les balises HTML doivent être fermées correctement

SI le rapport est incomplet (sections manquantes, arrêt brutal), c'est INACCEPTABLE !

GÉNÈRE maintenant un rapport HTML COMPLET ET ENTIER avec TOUTES les sections spécialisées pour "${template.focus}" !`;

    const response = await retryAPICall(async () => {
      return await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 20000,
        messages: [{ role: 'user', content: reportPrompt }]
      });
    });

    let reportContent = response.content[0].text;
    if (reportContent.includes('```html')) {
      reportContent = reportContent.replace(/```html\s*/, '').replace(/```\s*$/, '');
    }

    res.json({
      reportHtml: reportContent,
      phase: 2,
      message: 'Structure du rapport générée avec succès',
      size: reportContent.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur Phase 2:', error);
    res.status(503).json({
      error: 'Erreur lors de la génération - API surchargée',
      retry: true,
      phase: 2
    });
  }
});

// PHASE 3: Finalisation
app.post('/api/finalize-report', async (req, res) => {
  try {
    const { reportHtml, fileName } = req.body;

    if (!reportHtml) {
      return res.status(400).json({ error: 'Rapport HTML manquant' });
    }

    res.json({
      reportHtml: reportHtml,
      fileName: fileName || 'rapport-final.html',
      phase: 3,
      message: 'Rapport finalisé - Prêt pour téléchargement',
      size: reportHtml.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur Phase 3:', error);
    res.status(500).json({ error: 'Erreur lors de la finalisation' });
  }
});

// PHASE 5: Enhancement visuel avec OpenAI
app.post('/api/enhance-report', async (req, res) => {
  try {
    // Vérifier la clé API OpenAI
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'missing-openai-key') {
      console.error('API Key OpenAI manquante pour Phase 5');
      return res.status(500).json({
        error: 'Configuration serveur incomplète - Clé API OpenAI manquante. Veuillez configurer OPENAI_API_KEY dans les variables d\'environnement.',
        phase: 5
      });
    }

    const { reportHtml, fileName, reportType = 'intervention' } = req.body;

    if (!reportHtml) {
      return res.status(400).json({ error: 'Rapport HTML manquant' });
    }

    // NOUVEAU: Demander à GPT-5 de générer un design WAOUH spectaculaire

    // Extraire la structure HTML pour que GPT-5 connaisse les vrais sélecteurs
    const htmlPreview = reportHtml.substring(0, 8000); // Premiers 8000 caractères pour voir la structure

    const enhancementPrompt = `🎨 MISSION SPECTACULAIRE: Transformer ce rapport en une expérience visuelle WAOUH avec SVG interactifs, animations, et design moderne.

📄 VOICI LE HTML ACTUEL (extrait):
${htmlPreview}

⚠️ IMPORTANT: Utilise UNIQUEMENT les sélecteurs CSS qui EXISTENT dans ce HTML (h1, h2, h3, table, section, div, etc.). NE PAS inventer de classes qui n'existent pas (.hero, .kpi-grid, etc.).

📋 RETOURNE CE FORMAT JSON:
{
  "newCSS": "/* CSS ultra-moderne avec animations */",
  "svgInjections": [
    {"selector": ".section-header", "position": "prepend", "svg": "<svg>...</svg>"},
    {"selector": "h1", "position": "after", "svg": "<svg class='decorative-wave'>...</svg>"}
  ]
}

🎨 DESIGN SYSTEM HARMONIEUX (Cohésion Visuelle):

🎯 PALETTE ÉPURÉE (Focus Bleu Monochrome):
--bg-primary: #ffffff | --bg-secondary: #f8fafc | --bg-tertiary: #eff6ff
--primary: #3b82f6 | --primary-light: #60a5fa | --primary-dark: #2563eb
--accent: #dbeafe (bleu très clair pour accents subtils)
--text-primary: #0f172a | --text-secondary: #64748b | --text-muted: #94a3b8
--border: rgba(59,130,246,0.12) (bordures subtiles bleu clair)
--shadow: 0 2px 8px rgba(59,130,246,0.08) (ombre unique pour cohérence)

⚠️ RÈGLE COULEUR STRICTE (ABSOLUE):
- Utilise UNIQUEMENT les bleus ci-dessus (#3b82f6, #60a5fa, #2563eb, #dbeafe)
- ⚠️ INTERDIT: #28a745 (vert), #dc3545 (rouge), #ffc107 (orange), #8b5cf6 (violet)
- Même pour success/warning: utilise des teintes de bleu (success = #60a5fa, warning = #93c5fd)
- Maximum 3 nuances de bleu par page (primary, light, accent)
- Si tu vois du vert/rouge/orange dans ton CSS → ERREUR, recommence

📏 ÉCHELLE D'ESPACEMENT STRICTE:
--space-xs: 8px | --space-sm: 12px | --space-md: 16px | --space-lg: 24px | --space-xl: 32px | --space-2xl: 48px
⚠️ Utilise UNIQUEMENT ces valeurs. PAS de padding:80px ou margin:96px. Maximum padding pour cards: 24px.

💎 CSS OBLIGATOIRE (Cohésion Visuelle):
- Glassmorphism subtil: backdrop-filter blur(8px) + border: 1px solid var(--border)
- Hover effects LÉGERS: transform translateY(-1px) + box-shadow: var(--shadow) (PAS de scale, PAS de shadow exagéré)
- Gradients SIMPLES: linear-gradient(135deg, #3b82f6, #60a5fa) SEULEMENT (2 couleurs max, même famille)
- Tables: border: 1px solid var(--border) + hover background: rgba(59,130,246,0.03) (très subtil)
- Animations DOUCES: @keyframes fadeIn, slideIn UNIQUEMENT (PAS de pulse/glow/holographic)
- Typography: -apple-system, font-size: 14px body, 18px h4, 24px h3, 32px h2, 42px h1 (échelle claire)
- Font-weight: 400 normal, 600 semi-bold, 700 bold UNIQUEMENT
- Scrollbar: ::-webkit-scrollbar width 8px, track #f1f5f9, thumb #cbd5e1

🎨 SVG À GÉNÉRER (svgInjections) - MAXIMUM 10 SVG:

⚠️ RÈGLES STRICTES SVG:
- MAXIMUM 10 SVG au total (pas plus!)
- UNIQUEMENT palette bleu monochrome (#3b82f6, #60a5fa, #93c5fd)
- MÊME stroke-width partout (2px)
- PAS de couleurs rouge/vert/orange/violet dans les SVG
- Chaque SVG doit avoir un BUT précis, PAS de décoration gratuite

1. **Icônes h2/h3 UNIQUEMENT** (5-6 SVG max):
   - 24x24px, stroke #3b82f6, stroke-width 2px
   - Placement: prepend sur h2/h3 avec class .section-header
   - Style simple (pas de fill complexe, juste stroke)

2. **Charts SIMPLES** (2-3 SVG max):
   - Bar chart OU Line chart (PAS les deux, choisis UN seul type)
   - 300x200px maximum
   - Palette bleu monochrome uniquement
   - ⚠️ INTERDIT: Pie charts (trop de couleurs), Network graphs, Flowcharts

3. **Éléments fonctionnels** (1-2 SVG max):
   - Progress bars ou badges SI nécessaire pour les données
   - ⚠️ INTERDIT: Vagues décoratives, particules flottantes, separators entre sections

⚠️ PAS DE SVG JUSTE POUR LE "PRÉSENTÉISME":
- Si un élément n'apporte pas d'information → NE PAS le générer
- Exemple INTERDIT: 6 cercles identiques sans signification claire
- Exemple BON: 3 cercles représentant 3 KPIs différents avec labels clairs

⚡ ANIMATIONS CSS MINIMALISTES (Cohésion):

/* Animations de base UNIQUEMENT - PAS d'effets holographiques/rainbow */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

⚠️ RÈGLE ANIMATION: Utilise UNIQUEMENT fadeIn, slideIn, fadeInUp.
PAS de: pulse, glow, holoShine, prismShift, ripple, floatY, skeleton, bounce, rotate360, countUp, scaleIn.
Ces effets créent du bruit visuel et cassent la cohésion.

🎯 OBJECTIF COHÉSION VISUELLE (Design Épuré):
- SVG LIMITÉ et CIBLÉ: 8-12 SVG maximum, UNIQUEMENT pour h2/h3 + 2-3 charts
- SVG cohérents: MÊME style (line-width, couleurs bleu monochrome), PAS de mix styles
- Card-based layout SOBRE: fond blanc, border subtile, PAS d'overlays flashy
- Animations MINIMALISTES: fadeIn au chargement, hover subtil (-1px), PAS de pulse/glow/ripple
- Graphiques SIMPLES: bar/line charts SVG avec palette bleu uniquement
- Typographie HIÉRARCHISÉE: 42px h1, 32px h2, 24px h3, 18px h4, 14px body (échelle claire)
- Micro-interactions SUBTILES: hover -1px + shadow légère, PAS d'effets spectaculaires
- Gradients SIMPLES: linear-gradient(135deg, #3b82f6, #60a5fa) si nécessaire, PAS de mesh/rainbow
- Espaces COMPACTS: padding 24px max pour cards, margin 48px entre sections
- Icons SVG UNIQUEMENT pour h2/h3, PAS pour chaque élément
- Bordures UNIFORMES: 1px solid rgba(59,130,246,0.12) partout
- Shadow UNIQUE: 0 2px 8px rgba(59,130,246,0.08) pour tous les cards

💡 PRINCIPES COHÉSION VISUELLE (Design System Épuré):

🎯 HARMONIE COULEUR:
1. **Palette Monochrome Bleu**: Utilise UNIQUEMENT #3b82f6 (primary), #60a5fa (light), #2563eb (dark), #dbeafe (accent)
2. **Hiérarchie Claire**: Texte principal #0f172a (noir), secondaire #64748b (gris), muted #94a3b8 (gris clair)
3. **PAS de Multi-Couleurs**: Évite violet/vert/orange/rouge sauf données critiques (1-2 max par page)

📏 ESPACEMENT UNIFORME:
4. **Échelle Stricte**: 8px, 12px, 16px, 24px, 32px, 48px UNIQUEMENT
5. **Cards Compactes**: padding 24px max, PAS de 80px ou 96px
6. **Sections Respirées**: margin-bottom 48px entre sections, PAS de 80px-120px

🎨 SVG COHÉRENTS (8-12 Maximum):
7. **Style Uniforme**: Même stroke-width (2px), même palette bleu, même border-radius (8px)
8. **Placement Ciblé**: h2/h3 icons UNIQUEMENT + 2-3 charts simples (bar/line)
9. **PAS de Décoration Excessive**: Évite separators SVG partout, waves, particles, network graphs
10. **Charts Simples**: Bar/line charts avec données réelles, PAS de pie charts multicolores

✨ ANIMATIONS MINIMALISTES:
11. **fadeIn Subtil**: opacity 0→1 + translateY 12px au chargement UNIQUEMENT
12. **Hover Léger**: translateY -1px + shadow subtile, PAS de scale/glow/ripple
13. **PAS d'Effets Spectaculaires**: Évite holographic, rainbow, pulse, bounce, rotate, parallax

🧹 DESIGN ÉPURÉ:
14. **Glassmorphism Subtil**: backdrop-filter blur(8px) + border 1px, PAS de saturation boost
15. **Bordures Uniformes**: 1px solid rgba(59,130,246,0.12) partout, PAS de border glow multicolore
16. **Shadow Unique**: 0 2px 8px rgba(59,130,246,0.08) pour TOUS les cards
17. **Gradients Simples**: linear-gradient(135deg, #3b82f6, #60a5fa) si nécessaire (2 couleurs max)

🎨 RÈGLES SVG (Qualité > Quantité):
- MAXIMUM 10 SVG injections TOTAL (pas 8-12, mais 10 MAX!)
- h2/h3 icons: 24x24px, stroke-width 2px, couleur #3b82f6UNIQUEMENT
- Charts: 300x200px, palette bleu monochrome (#3b82f6, #60a5fa, #93c5fd) UNIQUEMENT
- UN SEUL type de chart (bar OU line, pas les deux)
- ⚠️ INTERDICTIONS ABSOLUES:
  * Pie charts multicolores
  * Cercles décoratifs multiples sans signification
  * Network graphs / Flowcharts / Mindmaps
  * Vagues / Particles / Separators décoratifs
  * SVG avec rouge/vert/orange/violet
  * Tout SVG "juste pour faire joli" sans apporter d'info

🎭 EFFETS INTERACTIFS MINIMALISTES (Cohésion):

1. **Hover Subtle** (cards/buttons):
   element:hover {
     transform: translateY(-1px);
     box-shadow: 0 2px 8px rgba(59,130,246,0.08);
     transition: all 0.2s ease;
   }
   ⚠️ PAS de scale(), PAS de shadow exagérée (20px 60px), PAS de lift -4px

2. **Border Cohérent**:
   element {
     border: 1px solid rgba(59,130,246,0.12);
     border-radius: 8px;
   }
   ⚠️ PAS de holographic border, PAS de rainbow gradients, PAS de border animations

3. **Spacing Uniforme**:
   section { padding: var(--space-2xl) var(--space-lg); margin-bottom: var(--space-2xl); }
   card { padding: var(--space-lg); }
   ⚠️ PAS de padding 80px, PAS de margin 96px, PAS d'espaces blancs généreux

🖼️ GÉNÉRATION D'IMAGES (tu peux générer des images!):
Tu as la capacité de GÉNÉRER DES IMAGES directement. Utilise cette capacité pour créer des visuels spectaculaires:
- Génère une image hero moderne et professionnelle pour le header (thème finance, style Stripe/Vercel)
- Génère des illustrations pour les concepts clés (graphiques financiers, diagrammes, icônes)
- Génère des images d'accent pour les cards (patterns géométriques, abstractions)
- Style: moderne, professionnel, couleurs cohérentes (bleus #3b82f6, violet #8b5cf6)

Quand tu génères une image, ajoute-la dans svgInjections comme:
{"selector": "h1", "position": "after", "svg": "<img src='IMAGE_URL_GENEREE' style='width:100%; max-width:600px; border-radius:12px; margin:20px 0;'>"}

⚠️ VALIDATION FINALE OBLIGATOIRE:
Avant de retourner le JSON, VÉRIFIE et CORRIGE:
1. Cherche dans newCSS: #28a745, #dc3545, #ffc107 → REMPLACE par #60a5fa
2. Compte svgInjections → si > 10, GARDE les 10 premiers UNIQUEMENT
3. Supprime SVG avec "75% complété" illisible
4. Supprime data:image cassées

RETOURNE le JSON avec:
- newCSS: palette bleu monochrome UNIQUEMENT (#3b82f6, #60a5fa, #dbeafe)
- svgInjections: MAXIMUM 10 SVG informatifs`;

    const response = await retryAPICall(async () => {
      // Utiliser l'API Responses directement avec axios
      return await axios.post('https://api.openai.com/v1/responses', {
        model: 'gpt-5',
        input: enhancementPrompt,
        reasoning: { effort: "high" },
        text: { verbosity: "high" },
        max_output_tokens: 32768
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
    });

    // Extraire la réponse JSON de GPT-5
    let gpt5Response = '';
    if (response.data && response.data.output) {
      const messageItem = response.data.output.find(item => item.type === 'message');
      if (messageItem && messageItem.content && messageItem.content[0]) {
        gpt5Response = messageItem.content[0].text;
      }
    }

    if (!gpt5Response) {
      console.error('Format de réponse GPT-5 inattendu:', response.data);
      throw new Error('Impossible d\'extraire le contenu de la réponse GPT-5');
    }

    console.log('=== DEBUG GPT-5 RESPONSE ===');
    console.log('Longueur totale:', gpt5Response.length);
    console.log('Premiers 1000 caractères:', gpt5Response.substring(0, 1000));
    console.log('Derniers 500 caractères:', gpt5Response.substring(gpt5Response.length - 500));

    // Nettoyer et parser le JSON
    let jsonContent = gpt5Response;
    if (jsonContent.includes('```json')) {
      jsonContent = jsonContent.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    }
    jsonContent = jsonContent.trim();

    let enhancements;
    try {
      enhancements = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error('Erreur parsing JSON GPT-5:', parseError);
      console.error('Contenu reçu:', gpt5Response.substring(0, 500));
      throw new Error(`Erreur parsing JSON de GPT-5: ${parseError.message}`);
    }

    console.log('=== DEBUG ENHANCEMENTS PARSED ===');
    console.log('newCSS présent:', !!enhancements.newCSS, 'Longueur:', enhancements.newCSS?.length);
    console.log('svgInjections présent:', !!enhancements.svgInjections);
    console.log('svgInjections est array:', Array.isArray(enhancements.svgInjections));
    console.log('Nombre de SVG:', enhancements.svgInjections?.length);
    if (enhancements.svgInjections?.length > 0) {
      console.log('Premier SVG injection:', JSON.stringify(enhancements.svgInjections[0], null, 2));
    }

    // Vérifier la structure JSON
    if (!enhancements.newCSS || !Array.isArray(enhancements.svgInjections)) {
      throw new Error('Structure JSON invalide - newCSS ou svgInjections manquant');
    }

    // ⚠️ POST-VALIDATION OBLIGATOIRE: Forcer la cohésion (GPT-5 ignore les instructions)
    console.log('=== POST-VALIDATION: CORRECTION FORCÉE ===');

    // 1. Remplacer toutes les couleurs interdites dans le CSS
    if (enhancements.newCSS) {
      const beforeCSS = enhancements.newCSS;
      enhancements.newCSS = enhancements.newCSS
        .replace(/#28a745/gi, '#60a5fa')  // vert → bleu clair
        .replace(/#dc3545/gi, '#3b82f6')  // rouge → bleu
        .replace(/#ffc107/gi, '#93c5fd')  // orange → bleu très clair
        .replace(/#17a2b8/gi, '#60a5fa')  // cyan → bleu clair
        .replace(/--success:\s*#28a745/gi, '--success: #60a5fa')
        .replace(/--danger:\s*#dc3545/gi, '--danger: #3b82f6')
        .replace(/--warning:\s*#ffc107/gi, '--warning: #93c5fd')
        .replace(/--info:\s*#17a2b8/gi, '--info: #60a5fa');

      if (beforeCSS !== enhancements.newCSS) {
        console.log('✅ Couleurs interdites remplacées dans le CSS');
      }
    }

    // 2. Limiter les SVG à 10 maximum
    if (enhancements.svgInjections && enhancements.svgInjections.length > 10) {
      console.log(`⚠️ Trop de SVG (${enhancements.svgInjections.length}), limitation à 10`);
      enhancements.svgInjections = enhancements.svgInjections.slice(0, 10);
    }

    // 3. Supprimer les SVG illisibles/inutiles
    if (enhancements.svgInjections) {
      const beforeCount = enhancements.svgInjections.length;
      enhancements.svgInjections = enhancements.svgInjections.filter(inj => {
        const svg = inj.svg || inj.svgCode || '';

        // Supprimer les pourcentages sur fond sombre (illisible)
        const hasCompletedText = svg.includes('complété') || svg.includes('75%') || svg.includes('90%') || svg.includes('85%') || svg.includes('80%') || svg.includes('70%') || svg.includes('60%');
        const hasDarkFill = svg.includes('fill="%230f172a"') || svg.includes('fill="#0f172a"') || svg.includes('fill="%231e293b"') || svg.includes('fill="#1e293b"');
        if (hasCompletedText && hasDarkFill) {
          console.log('🗑️ SVG illisible supprimé:', inj.selector || inj.targetSelector);
          return false;
        }

        // Supprimer les SVG "Avancement du rapport" inutiles
        if (svg.includes('Avancement du rapport') || svg.includes('avancement') || (svg.includes('82%') && svg.includes('rapport'))) {
          console.log('🗑️ SVG "Avancement" inutile supprimé:', inj.selector || inj.targetSelector);
          return false;
        }

        return true;
      });

      if (beforeCount !== enhancements.svgInjections.length) {
        console.log(`✅ ${beforeCount - enhancements.svgInjections.length} SVG inutiles supprimés`);
      }
    }

    // 4. Ajouter CSS pour espacer les puces de listes (décaler de la bordure gauche)
    if (enhancements.newCSS) {
      enhancements.newCSS += `\n\n/* Espacement des listes - décalage de la bordure gauche */\nul, ol { margin-left: 20px; padding-left: 24px; }\nli { margin-bottom: 8px; }\n`;
      console.log('✅ CSS espacement listes ajouté');
    }

    // 5. Ajouter CSS pour centrer les graphiques SVG après .chart-container
    if (enhancements.newCSS) {
      enhancements.newCSS += `\n\n/* Centrage des graphiques SVG injectés */\n.chart-container + svg, section > svg, .card > svg { display: block; margin: 24px auto !important; text-align: center; }\nsvg[width="300"], svg[width="320"] { display: block; margin: 24px auto !important; }\n`;
      console.log('✅ CSS centrage graphiques SVG ajouté');
    }

    console.log('=== FIN POST-VALIDATION ===');

    // INJECTION HYBRIDE: Parser le HTML original et injecter les améliorations
    const cheerio = require('cheerio');
    const $ = cheerio.load(reportHtml);

    // 1. AJOUTER le CSS glassmorphism SANS supprimer le CSS original
    // On garde le style existant et on ajoute le nouveau CSS en complément
    $('head').append(`<style id="glassmorphism-enhancement">${enhancements.newCSS}</style>`);

    // 2. Injecter les SVG selon les instructions (FIX: utiliser les bons noms de propriétés)
    let injectedCount = 0;
    for (const injection of enhancements.svgInjections) {
      // Support des deux formats: {selector, position, svg} ET {targetSelector, position, svgCode}
      const selector = injection.selector || injection.targetSelector;
      const position = injection.position;
      const svgCode = injection.svg || injection.svgCode;

      if (!selector || !position || !svgCode) {
        console.warn('SVG injection invalide:', injection);
        continue;
      }

      const $target = $(selector);

      if ($target.length > 0) {
        if (position === 'append') {
          $target.append(svgCode);
        } else if (position === 'prepend') {
          $target.prepend(svgCode);
        } else if (position === 'after') {
          $target.after(svgCode);
        } else if (position === 'before') {
          $target.before(svgCode);
        }
        injectedCount++;
        console.log(`✅ SVG injecté: ${selector} (${position})`);
      } else {
        console.warn(`⚠️ Sélecteur non trouvé: ${selector}`);
      }
    }
    console.log(`=== TOTAL SVG INJECTÉS: ${injectedCount}/${enhancements.svgInjections.length} ===`);

    // 3. Extraire le HTML final amélioré
    const enhancedHtml = $.html();

    console.log('Phase 5 - Enhancement généré, taille:', enhancedHtml.length);

    res.json({
      reportHtml: enhancedHtml,
      fileName: fileName ? `${fileName.replace('.html', '')}-enhanced.html` : 'enhanced.html',
      phase: 5,
      message: 'Enhancement visuel OpenAI terminé',
      size: enhancedHtml.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur Phase 4:', error);
    res.status(503).json({
      error: 'Erreur lors de la conversion - API surchargée',
      retry: true,
      phase: 4
    });
  }
});

// Export pour Vercel
module.exports = app;