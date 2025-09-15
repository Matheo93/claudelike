const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
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
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`API surchargée, attente de ${waitTime}ms avant retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (attempt === maxRetries - 1) {
        throw error;
      } else {
        const waitTime = 1000 * (attempt + 1);
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

    const domainAnalysisPrompt = `Analyse ce contenu PDF et identifie le domaine principal. Fournis une analyse structurée détaillée.

CONTENU À ANALYSER:
${pdfContent.substring(0, 3000)}...

Réponds avec une analyse JSON structurée incluant:
1. domain: le domaine principal (cybersecurite/finance/technique/commercial/rh/juridique/medical/educatif/autre)
2. title: un titre descriptif du document
3. summary: un résumé en 2-3 phrases
4. key_topics: liste des 5 sujets principaux
5. context: contexte et importance du document
6. target_audience: public cible`;

    const response = await retryAPICall(async () => {
      return await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 2000,
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

    const reportPrompt = `Crée un rapport HTML ULTRA-PROFESSIONNEL de type "${template.title}" avec de nombreux éléments visuels basé sur cette analyse:

ANALYSE:
${analysis}

TYPE DE RAPPORT: ${template.focus.toUpperCase()}
SECTIONS REQUISES: ${template.sections.join(', ')}

INSTRUCTIONS CRITIQUES - RAPPORT DE NIVEAU CONSEIL:
1. INCLUS OBLIGATOIREMENT ces éléments visuels spécialisés:
   - ${template.visualizations.join('\n   - ')}
   - Graphiques radar/circulaires en SVG
   - Tableaux détaillés avec styles hover
   - Diagrammes de topologie/architecture
   - Matrices colorées (risque/opportunité selon le type)
   - Dashboards avec métriques adaptées
   - Boîtes statistiques avec chiffres
   - Graphiques en barres/histogrammes
   - Éléments interactifs (hover, animations CSS)

2. STYLES CSS AVANCÉS OBLIGATOIRES:
   - Gradients dans les headers adaptés au type ${reportType}
   - Ombres et effets de profondeur
   - Animations et transitions CSS
   - Responsive design complet
   - Couleurs professionnelles cohérentes selon le contexte

3. STRUCTURE ENRICHIE SPÉCIALISÉE:
   - Header avec titre "${template.title}" et métadonnées
   - Table des matières cliquable avec les ${template.sections.length} sections
   - Sections détaillées: ${template.sections.join(', ')}
   - Visualisations dans CHAQUE section
   - Boîtes d'alerte colorées adaptées au contexte
   - Résumé avec statistiques pertinentes
   - Annexes spécialisées

4. CONTENU RICHE ADAPTÉ AU TYPE ${reportType.toUpperCase()}:
   - Minimum 6-8 sections détaillées selon le template
   - 3-5 graphiques/diagrammes minimum spécialisés
   - 2-3 tableaux de données contextualisés
   - Métriques et KPIs visuels adaptés
   - Citations et références selon le type

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

// PHASE 4: Conversion en format Présentation
app.post('/api/convert-to-presentation', async (req, res) => {
  try {
    const { reportHtml, fileName, reportType = 'academique' } = req.body;

    if (!reportHtml) {
      return res.status(400).json({ error: 'Rapport HTML manquant' });
    }

    const conversionPrompt = `Tu es un expert en conversion de documents HTML. Tu dois transformer ce rapport HTML classique en format PRÉSENTATION interactive (comme PowerPoint mais en HTML).

RAPPORT HTML À CONVERTIR :
${reportHtml.substring(0, 15000)}...

INSTRUCTIONS STRICTES POUR LA CONVERSION :

1. STRUCTURE PRÉSENTATION :
   - Créer des SLIDES individuelles pour chaque section
   - Chaque slide = 1 section complète en plein écran
   - Navigation avec flèches gauche/droite et points indicateurs
   - Design moderne type dashboard

2. INTERFACE DE NAVIGATION :
   - Boutons flèche gauche/droite en bas de page
   - Indicateurs de progression (dots) au centre
   - Numérotation "X / Y" en haut à droite
   - Transitions CSS fluides entre slides

3. DESIGN SLIDES :
   - Chaque slide occupe 100vh (plein écran)
   - Titre principal en haut de chaque slide
   - Contenu centré et aéré
   - Conserver TOUS les graphiques SVG et tableaux
   - Palette couleur cohérente

4. FONCTIONNALITÉS JavaScript :
   - Navigation clavier (flèches)
   - Fonction nextSlide() et prevSlide()
   - Indicateur slide actuelle
   - Auto-resize responsive

5. SLIDES À CRÉER (selon ordre logique) :
   - Slide 1: Titre + Résumé (Abstract)
   - Slide 2: Introduction + Contexte
   - Slide 3: Méthodologie
   - Slide 4: Analyse des Données
   - Slide 5: Résultats
   - Slide 6: Discussion
   - Slide 7: Conclusion
   - Slide 8: Références

GÉNÈRE un HTML complet de présentation interactive avec navigation fluide !`;

    const response = await retryAPICall(async () => {
      return await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 18000,
        messages: [{ role: 'user', content: conversionPrompt }]
      });
    });

    let presentationHtml = response.content[0].text;

    console.log('Phase 4 - Première ligne de réponse:', presentationHtml.substring(0, 100));

    // Nettoyage plus robuste du contenu
    if (presentationHtml.includes('```html')) {
      presentationHtml = presentationHtml.replace(/```html\s*/g, '').replace(/```\s*$/g, '');
    }
    if (presentationHtml.includes('```')) {
      presentationHtml = presentationHtml.replace(/```[a-z]*\s*/g, '').replace(/```\s*$/g, '');
    }

    // S'assurer qu'on commence bien par <!DOCTYPE html>
    if (!presentationHtml.trim().startsWith('<!DOCTYPE html>')) {
      // Extraire le HTML si il est dans le texte
      const htmlMatch = presentationHtml.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
      if (htmlMatch) {
        presentationHtml = htmlMatch[0];
      } else {
        console.error('Phase 4 - HTML non valide détecté, contenu:', presentationHtml.substring(0, 500));
        return res.status(500).json({
          error: 'Format HTML invalide généré - Réessayez',
          phase: 4
        });
      }
    }

    console.log('Phase 4 - HTML nettoyé, taille:', presentationHtml.length);

    res.json({
      presentationHtml: presentationHtml,
      fileName: fileName ? `${fileName.replace('.html', '')}-presentation.html` : 'presentation.html',
      phase: 4,
      message: 'Conversion en présentation terminée',
      size: presentationHtml.length,
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