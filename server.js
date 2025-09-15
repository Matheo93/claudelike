const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/chat', async (req, res) => {
  try {
    const { message, pdfContent } = req.body;

    let fullPrompt = message;
    if (pdfContent) {
      fullPrompt = `Contenu du PDF:\n\n${pdfContent}\n\nQuestion: ${message}`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: fullPrompt
        }
      ]
    });

    res.json({
      response: response.content[0].text
    });
  } catch (error) {
    console.error('Erreur API Anthropic:', error);
    res.status(500).json({ error: 'Erreur lors de la communication avec Claude' });
  }
});

app.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
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
    console.error('Erreur extraction PDF:', error);
    res.status(500).json({ error: 'Erreur lors de l\'extraction du PDF' });
  }
});

app.post('/generate-report', async (req, res) => {
  try {
    const { pdfContent, fileName, reportType = 'professional' } = req.body;

    if (!pdfContent) {
      return res.status(400).json({ error: 'Aucun contenu PDF fourni' });
    }

    // Charger le template professionnel
    let template = '';
    try {
      template = fs.readFileSync(path.join(__dirname, 'public', 'Rapport_Intervention_AD_30personnes_Exemple.html'), 'utf8');
    } catch (error) {
      console.log('Template non trouvé, utilisation du format basique');
    }

    // Analyser le domaine du PDF pour adaptation contextuelle
    const domainAnalysisPrompt = `Analyse ce contenu PDF et identifie le domaine principal :

${pdfContent.substring(0, 2000)}...

Réponds uniquement avec l'un de ces domaines :
- cybersecurite
- finance
- technique
- commercial
- rh
- juridique
- medical
- educatif
- autre`;

    // Analyser le domaine avec retry
    let domainResponse;
    let domainRetries = 0;
    const maxDomainRetries = 5;

    while (domainRetries < maxDomainRetries) {
      try {
        domainResponse = await anthropic.messages.create({
          model: 'claude-opus-4-1-20250805',
          max_tokens: 200,
          messages: [{ role: 'user', content: domainAnalysisPrompt }]
        });
        break;
      } catch (error) {
        if (error.status === 529 && domainRetries < maxDomainRetries - 1) {
          console.log(`API surchargée (domaine), retry ${domainRetries + 1}/${maxDomainRetries} dans 5 secondes...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * (domainRetries + 1)));
          domainRetries++;
        } else {
          console.log('Erreur domaine, utilisation du domaine par défaut');
          domainResponse = { content: [{ text: 'autre' }] };
          break;
        }
      }
    }

    const domain = domainResponse.content[0].text.trim().toLowerCase();

    // Template adaptatif basé sur votre modèle professionnel
    const adaptivePrompt = `Tu es un expert consultant qui doit créer un rapport professionnel de haute qualité.

CONTEXTE :
- Domaine identifié : ${domain}
- Contenu à analyser : ${pdfContent}

TEMPLATE DE RÉFÉRENCE :
Utilise la structure et le style CSS du template professionnel fourni, mais adapte TOUT LE CONTENU au domaine ${domain}.

INSTRUCTIONS STRICTES :
1. CONSERVE la structure HTML et CSS exacte du template (header, sections, styles, graphiques)
2. ADAPTE tous les titres, sections et contenu au domaine ${domain}
3. REMPLACE les informations spécifiques cybersécurité par du contenu pertinent pour ${domain}
4. MAINTIENS le niveau de qualité professionnel et la mise en forme

STRUCTURE À ADAPTER :
- Header : Titre adapté au domaine + sous-titre pertinent
- Table des matières : Sections logiques pour ${domain}
- Sections principales : Analysées selon ${domain}
- Visualisations : Adaptées au contexte (garder les graphiques mais changer les données)
- Conclusion : Recommandations spécifiques au domaine

EXEMPLE D'ADAPTATION :
Si domaine = "commercial" et PDF = "export machines à café"
→ Titre : "Rapport d'Analyse Commerciale - Stratégie Export"
→ Sections : Analyse marché, Opportunités, Recommandations, Plan d'action

Génère maintenant un rapport HTML complet en adaptant intelligemment le template au contenu du PDF.

IMPORTANT : Retourne UNIQUEMENT le code HTML complet, sans commentaires ni explications.`;

    // Ajouter retry avec backoff pour gérer la surcharge API
    let response;
    let retries = 0;
    const maxRetries = 7;

    while (retries < maxRetries) {
      try {
        response = await anthropic.messages.create({
          model: 'claude-opus-4-1-20250805',
          max_tokens: 8000,
          stream: false,
          messages: [
            {
              role: 'user',
              content: adaptivePrompt
            }
          ]
        });
        break;
      } catch (error) {
        if (error.status === 529 && retries < maxRetries - 1) {
          console.log(`API surchargée, retry ${retries + 1}/${maxRetries} dans ${5 + retries * 2} secondes...`);
          await new Promise(resolve => setTimeout(resolve, (5000 + retries * 2000)));
          retries++;
        } else {
          // Si on échoue après tous les retries, on retourne une erreur plus explicite
          console.error('Erreur génération rapport après tous les retries:', error);
          return res.status(503).json({
            error: 'Service temporairement indisponible - API Anthropic surchargée. Le système a tenté 7 fois sans succès.',
            retry: true,
            suggestion: 'Patientez 5-10 minutes et réessayez. Les serveurs Claude sont très sollicités actuellement.'
          });
        }
      }
    }

    let reportContent = response.content[0].text;

    // Nettoyer le contenu si nécessaire
    if (reportContent.includes('```html')) {
      reportContent = reportContent.replace(/```html\s*/, '').replace(/```\s*$/, '');
    }

    res.json({
      reportHtml: reportContent,
      fileName: fileName ? `${fileName.replace('.pdf', '')}-rapport.html` : 'rapport-professionnel.html',
      domain: domain
    });
  } catch (error) {
    console.error('Erreur génération rapport:', error);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport' });
  }
});

// PHASE 1: Analyse du contenu PDF
app.post('/analyze-pdf', async (req, res) => {
  try {
    const { pdfContent } = req.body;

    if (!pdfContent) {
      return res.status(400).json({ error: 'Aucun contenu PDF fourni' });
    }

    const analysisPrompt = `Analyse ce contenu PDF en 2 étapes:

ÉTAPE 1: Identifie le domaine principal
Réponds uniquement avec l'un de ces domaines: cybersecurite, finance, technique, commercial, rh, juridique, medical, educatif, autre

ÉTAPE 2: Structure l'information
Extrais et organise:
- Sujet principal du document
- 5-7 sections clés identifiées
- Points importants par section
- Conclusion/recommandations si présentes

CONTENU À ANALYSER:
${pdfContent.substring(0, 3000)}...

FORMAT DE RÉPONSE:
DOMAINE: [domaine]

SUJET: [sujet principal en une phrase]

SECTIONS:
1. [Titre section] - [résumé en 2 lignes]
2. [Titre section] - [résumé en 2 lignes]
...

POINTS_CLÉS:
- [point important 1]
- [point important 2]
...`;

    const response = await retryAPICall(async () => {
      return await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 2000,
        messages: [{ role: 'user', content: analysisPrompt }]
      });
    });

    res.json({
      analysis: response.content[0].text,
      phase: 1,
      message: 'Analyse terminée avec succès'
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
app.post('/generate-report-structure', async (req, res) => {
  try {
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
      fileName: fileName ? `${fileName.replace('.pdf', '')}-rapport.html` : 'rapport-professionnel.html',
      phase: 2,
      message: 'Rapport généré avec succès'
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
app.post('/finalize-report', async (req, res) => {
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
app.post('/convert-to-presentation', async (req, res) => {
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

// Fonction utilitaire pour retry avec backoff
async function retryAPICall(apiFunction, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiFunction();
    } catch (error) {
      if (error.status === 529 && attempt < maxRetries - 1) {
        const waitTime = (attempt + 1) * 3000; // 3s, 6s, 9s, 12s, 15s
        console.log(`API surchargée, retry ${attempt + 1}/${maxRetries} dans ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});