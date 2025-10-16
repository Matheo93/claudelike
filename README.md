# 🚀 SlideForge AI - Transform PDFs into Stunning Interactive Presentations

> **The most intelligent PDF-to-Presentation converter with AI Chat Editing**
> Upload any PDF, chat with AI to customize slides, download beautiful presentations in seconds.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![DeepSeek AI](https://img.shields.io/badge/AI-DeepSeek-blue)](https://deepseek.com/)

## 📋 Description

SlideForge AI est une application web révolutionnaire qui transforme vos documents PDF en présentations professionnelles interactives. Avec son interface de chat AI intégrée, vous pouvez modifier vos slides en langage naturel et voir les changements en temps réel.

## ✨ Fonctionnalités Principales

### 📊 Système 5-Phases Intelligent
- **Phase 1**: Analyse automatique du domaine et extraction du contenu
- **Phase 2**: Génération de rapport professionnel (20 000 tokens)
- **Phase 3**: Finalisation et optimisation
- **Phase 5**: Enhancement visuel avec OpenAI (SVG, graphiques avancés, animations)
- **Phase 4**: Conversion en présentation interactive (type PowerPoint en HTML)

### 🎨 Types de Rapports
- **📚 Académique**: Structure scientifique avec méthodologie rigoureuse
- **🔧 Intervention**: Rapports techniques détaillés
- **💼 Exécutif**: Synthèses stratégiques avec KPIs

### 🎯 Caractéristiques Avancées
- **Phase 5 NEW**: Enhancement visuel avec OpenAI GPT-4o
- Visualisations SVG interactives et animations CSS
- Graphiques avancés : pie charts, timeline, jauges, diagrammes
- Tableaux de bord avec métriques colorées
- Navigation par slides (présentation)
- Support PDF jusqu'à 50MB
- Retry automatique en cas de surcharge API

## 🛠️ Installation Locale

```bash
# Cloner le repository
git clone https://github.com/votre-username/docgenius.git
cd docgenius

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env et ajouter votre ANTHROPIC_API_KEY

# Lancer en développement
npm start
```

## 🌐 Déploiement sur Vercel

### 1. Préparer le déploiement

```bash
# S'assurer que le projet est prêt
npm install
git add .
git commit -m "Initial DocGenius deployment"
```

### 2. Déployer sur Vercel

```bash
# Installer Vercel CLI si nécessaire
npm i -g vercel

# Déployer
vercel

# Suivre les instructions:
# - Set up and deploy: Y
# - Which scope: (votre compte)
# - Link to existing project?: N
# - Project name: docgenius
# - Directory: ./
# - Override settings?: N
```

### 3. Configurer les variables d'environnement

Dans le dashboard Vercel (vercel.com):
1. Aller dans Project Settings > Environment Variables
2. Ajouter: `ANTHROPIC_API_KEY` = votre clé API

### 4. Configurer les limites (Pro/Enterprise)

Pour augmenter les limites à 15 minutes (900s):
- Plan Pro/Enterprise requis
- Les limites sont déjà configurées dans `vercel.json`

## 📁 Structure du Projet

```
docgenius/
├── api/
│   └── index.js         # Fonctions serverless Vercel
├── public/
│   └── index.html       # Interface utilisateur
├── vercel.json          # Configuration Vercel
├── package.json         # Dépendances
└── .env                 # Variables d'environnement (local)
```

## 🔑 Variables d'Environnement

```env
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
```

## 🚀 Utilisation

1. **Uploader un PDF**: Cliquez sur "📄 Télécharger un PDF"
2. **Sélectionner le type**: Choisissez entre Académique, Intervention ou Exécutif
3. **Générer le rapport**: Cliquez sur "📊 Générer Rapport Pro"
4. **Enhancement visuel** (optionnel): "✨ Enhancement Visuel (OpenAI)" pour SVG avancés
5. **Convertir en présentation** (optionnel): "🎯 Convertir en Présentation"
6. **Télécharger**: Sauvegardez votre rapport ou présentation HTML

## 📊 Limites Techniques

- **Taille PDF**: Maximum 50MB
- **Timeout**: 15 minutes (900s) sur Vercel Pro
- **Tokens Phase 2**: 20 000 (rapports complets garantis)
- **Tokens Phase 5**: 16 384 (OpenAI maximum pour enhancement complet)
- **Tokens Phase 4**: 18 000 (présentations complètes)

## 🛡️ Sécurité

- Clé API stockée en variable d'environnement
- Pas de stockage permanent des PDF
- Traitement en mémoire uniquement
- CORS configuré pour sécurité

## 🤝 Contribution

Les contributions sont bienvenues ! N'hésitez pas à ouvrir des issues ou des pull requests.

## 📝 Licence

MIT

## 🙏 Crédits

- **APIs**: Claude Opus (Anthropic) + OpenAI GPT-4o
- **Framework**: Express.js + Vercel Serverless
- **PDF Processing**: pdf-parse
- **Enhancement**: OpenAI pour SVG et visualisations avancées

---

Développé avec ❤️ par [Votre Nom]