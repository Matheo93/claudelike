const cheerio = require('cheerio');

function extractSectionsFromReport(reportHtml) {
  const $ = cheerio.load(reportHtml);
  const sections = [];

  $('section').each((index, element) => {
    const $section = $(element);
    const sectionId = $section.attr('id');

    // Skip hero section
    if (sectionId === 'hero') return;

    let title = $section.find('h2').first().text().trim() || `Section ${index + 1}`;
    const content = $section.html();

    if (sectionId && content) {
      sections.push({ id: sectionId, title: title, content: content });
    }
  });

  return sections;
}

function extractReportTitle(reportHtml) {
  const $ = cheerio.load(reportHtml);
  return $('section[id="hero"] h1').first().text().trim() || $('title').text().trim() || 'Report';
}

function extractReportSubtitle(reportHtml) {
  const $ = cheerio.load(reportHtml);
  return $('section[id="hero"] p').first().text().trim() || 'Analysis Report';
}

function generatePresentationHTML(reportHtml, fileName = 'report') {
  const sections = extractSectionsFromReport(reportHtml);
  const title = extractReportTitle(reportHtml);
  const subtitle = extractReportSubtitle(reportHtml);

  const contentSlides = sections.map((section, index) => `
    <div class="slide" data-index="${index + 2}" data-title="${section.title}">
      ${section.content}
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    :root {
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #9333ea;
      --cyan: #06b6d4;
      --dark: #1e293b;
      --gray: #64748b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      overflow: hidden;
      background: #f8fafc;
      color: var(--dark);
    }
    .container {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .nav {
      background: linear-gradient(90deg, #1e40af 0%, #93c5fd 100%);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: white;
      z-index: 100;
      gap: 20px;
      transition: background 0.4s ease;
    }
    .slide-menu {
      flex: 1;
      display: flex;
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.3) transparent;
    }
    .slide-menu::-webkit-scrollbar {
      height: 4px;
    }
    .slide-menu::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
    }
    .slide-menu-item {
      padding: 6px 14px;
      border-radius: 16px;
      background: rgba(255,255,255,0.15);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .slide-menu-item:hover {
      background: rgba(255,255,255,0.25);
      transform: translateY(-1px);
    }
    .slide-menu-item.active {
      background: rgba(255,255,255,0.35);
      font-weight: 600;
    }
    .nav button {
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    }
    .nav button:hover { background: rgba(255,255,255,0.3); }
    .nav-progress {
      height: 3px;
      background: rgba(59,130,246,0.15);
      position: relative;
    }
    .nav-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #9333ea);
      width: 0%;
      transition: width 0.3s;
    }
    .slides {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    .slide {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.4s, visibility 0.4s;
      overflow-y: auto;
      padding: 40px 80px;
    }
    .slide.active {
      opacity: 1;
      visibility: visible;
    }
    .indicators {
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 10px;
      z-index: 100;
    }
    .indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(59,130,246,0.3);
      cursor: pointer;
      transition: all 0.3s;
    }
    .indicator.active {
      background: #3b82f6;
      transform: scale(1.3);
    }
    h1 { font-size: 2.5rem; margin-bottom: 24px; color: var(--dark); }
    h2 { font-size: 2rem; margin: 20px 0 16px; color: var(--dark); }
    h3 { font-size: 1.5rem; margin: 16px 0 12px; color: var(--dark); }
    h4 { font-size: 1.2rem; margin: 12px 0 8px; color: var(--dark); }
    p { font-size: 1.1rem; line-height: 1.7; margin: 12px 0; }

    .section-header {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 32px;
    }
    .icon-circle {
      display: inline-flex;
      width: 64px;
      height: 64px;
      border-radius: 16px;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      flex-shrink: 0;
    }
    .card {
      padding: 32px;
      border-radius: 20px;
      border: 1px solid;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
      margin-bottom: 24px;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 24px rgba(0,0,0,0.1);
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin: 20px 0; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 20px 0; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      color: white;
      margin: 4px;
    }
    .progress-bar {
      background: #f3f4f6;
      height: 24px;
      border-radius: 12px;
      overflow: hidden;
      margin: 16px 0;
    }
    .progress-fill {
      height: 100%;
      border-radius: 12px;
      transition: width 1s ease-out;
    }
    .toc-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 24px;
      margin-top: 32px;
      max-width: 1200px;
    }
    .toc-card {
      cursor: pointer;
      padding: 28px;
      border-radius: 20px;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .toc-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.15);
    }
    .number-badge {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 1.3rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .slide-header {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 40px;
    }

    /* Additional styles for content elements */
    .icon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 20px;
      margin: 24px 0;
    }
    .icon-item {
      text-align: center;
      padding: 20px;
      border-radius: 16px;
      transition: transform 0.3s ease;
    }
    .icon-item:hover {
      transform: translateY(-4px);
    }
    .icon-display {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin: 0 auto 12px;
    }
    .metric-large {
      font-size: 3.5rem;
      font-weight: 700;
      margin: 20px 0;
      text-align: center;
    }
    .flow-diagram {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
      margin: 32px 0;
    }
    .flow-step {
      text-align: center;
      flex: 0 0 auto;
      max-width: 160px;
    }
    .flow-step p {
      white-space: nowrap;
      overflow: visible;
    }
    .flow-number {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 auto 8px;
    }
    .arrow {
      font-size: 2rem;
      color: var(--gray);
      opacity: 0.5;
    }
    .percentage-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      border: 6px solid;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
      margin: 24px 0;
    }
    .stat-box {
      padding: 24px;
      border-radius: 16px;
      border: 1px solid;
      text-align: center;
      transition: transform 0.3s ease;
    }
    .stat-box:hover {
      transform: translateY(-4px);
    }
    .stat-number {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0;
    }
    .alert-box {
      padding: 20px;
      border-radius: 12px;
      display: flex;
      align-items: start;
      gap: 16px;
      margin: 16px 0;
      background: linear-gradient(90deg, rgba(239,68,68,0.1) 0%, rgba(245,158,11,0.1) 100%);
      border-left: 4px solid var(--danger);
    }
    .slide-in-left {
      animation: slideInLeft 0.6s ease-out;
    }
    .slide-in-right {
      animation: slideInRight 0.6s ease-out;
    }
    .fade-in {
      animation: fadeIn 0.8s ease-out;
    }
    @keyframes slideInLeft {
      from {
        opacity: 0;
        transform: translateX(-30px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(30px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav" id="nav">
      <button onclick="prev()">← Previous</button>
      <div class="slide-menu" id="slideMenu"></div>
      <span id="counter" style="font-size:0.9rem; opacity:0.8;">1 / ${sections.length + 2}</span>
      <button onclick="next()">Next →</button>
    </div>
    <div class="slides">
      <div class="slide active" data-index="0" data-title="${title}">
        <div style="height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; border-radius:0; padding:80px 60px; position:relative; overflow:hidden; box-shadow:0 8px 32px rgba(118,75,162,0.3);">
          <!-- Decorative circles -->
          <div style="position:absolute; top:-50px; right:-50px; width:200px; height:200px; border-radius:50%; background:rgba(255,255,255,0.1);"></div>
          <div style="position:absolute; bottom:-80px; left:-80px; width:250px; height:250px; border-radius:50%; background:rgba(255,255,255,0.08);"></div>
          <div style="position:absolute; top:50%; left:10%; width:100px; height:100px; border-radius:50%; background:rgba(255,255,255,0.06);"></div>

          <!-- Content wrapper -->
          <div style="position:relative; z-index:1;">
            <div style="display:inline-block; background:rgba(255,255,255,0.15); padding:8px 20px; border-radius:20px; font-size:0.85rem; font-weight:600; margin-bottom:20px; letter-spacing:1px; text-transform:uppercase;">Professional Analysis</div>
            <h1 style="font-size:4rem; margin:0 0 20px 0; color:white !important; font-weight:700; letter-spacing:-1px; text-shadow:0 2px 20px rgba(0,0,0,0.2);">${title}</h1>
            <p style="font-size:1.4rem; opacity:0.95; margin:0 auto; max-width:700px; line-height:1.6; color:white;">${subtitle}</p>
            <div style="display:flex; gap:12px; justify-content:center; margin-top:32px; flex-wrap:wrap;">
              <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px; color:white;"><span style="font-size:1.1rem;">📊</span>Valuation Analysis</div>
              <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px; color:white;"><span style="font-size:1.1rem;">💼</span>Market Dynamics</div>
              <div style="background:rgba(255,255,255,0.25); padding:10px 24px; border-radius:20px; font-weight:600; font-size:0.95rem; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); display:flex; align-items:center; gap:8px; color:white;"><span style="font-size:1.1rem;">📈</span>Risk Assessment</div>
            </div>
          </div>
        </div>
      </div>
      <div class="slide" data-index="1" data-title="Table of Contents">
        <div class="slide-header">
          <div class="icon-circle" style="background: var(--primary); color: white;">📋</div>
          <div>
            <h1>Table of Contents</h1>
            <p style="color: var(--gray);">Navigate through the presentation</p>
          </div>
        </div>
        <div class="toc-grid">
          ${sections.map((s, i) => {
            const colors = [
              { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)', badge: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)', icon: 'rgba(59,130,246,0.15)' },
              { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', badge: 'linear-gradient(135deg, #10b981 0%, #047857 100%)', icon: 'rgba(16,185,129,0.15)' },
              { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', badge: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', icon: 'rgba(245,158,11,0.15)' },
              { bg: 'rgba(147,51,234,0.1)', border: 'rgba(147,51,234,0.2)', badge: 'linear-gradient(135deg, #9333ea 0%, #7c3aed 100%)', icon: 'rgba(147,51,234,0.15)' },
              { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.2)', badge: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', icon: 'rgba(6,182,212,0.15)' }
            ];
            const emojis = ['📊', '💰', '📈', '🌐', '🎯', '💸', '✅'];
            const color = colors[i % colors.length];
            const emoji = emojis[i % emojis.length];
            return `
      <div class="toc-card" style="background:linear-gradient(135deg, ${color.bg} 0%, ${color.bg.replace('0.1', '0.05')} 100%); border:1px solid ${color.border};" onclick="goTo(${i + 2})">
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="number-badge" style="background:${color.badge};">${String(i + 1).padStart(2, '0')}</div>
          <div style="flex:1;">
            <div style="width:48px; height:48px; border-radius:12px; background:${color.icon}; display:flex; align-items:center; justify-content:center; font-size:24px; margin-bottom:8px;">${emoji}</div>
            <h3 style="margin:0; color:#1e293b; font-size:1.2rem;">${s.title}</h3>
          </div>
        </div>
      </div>
    `;
          }).join('')}
        </div>
      </div>
      ${contentSlides}
    </div>
    <div class="indicators" id="indicators"></div>
  </div>
  <script>
    let current = 0;
    const slides = document.querySelectorAll('.slide');
    const total = slides.length;
    const nav = document.getElementById('nav');
    const counter = document.getElementById('counter');
    const slideMenu = document.getElementById('slideMenu');
    const indicatorsContainer = document.getElementById('indicators');

    // Build slide menu
    slides.forEach((slide, i) => {
      const menuItem = document.createElement('div');
      menuItem.className = 'slide-menu-item' + (i === 0 ? ' active' : '');
      menuItem.textContent = slide.dataset.title || 'Slide ' + (i + 1);
      menuItem.onclick = () => goTo(i);
      slideMenu.appendChild(menuItem);
    });

    for(let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'indicator' + (i === 0 ? ' active' : '');
      dot.onclick = () => goTo(i);
      indicatorsContainer.appendChild(dot);
    }

    function update() {
      slides.forEach((s, i) => s.classList.toggle('active', i === current));
      document.querySelectorAll('.indicator').forEach((d, i) => d.classList.toggle('active', i === current));
      document.querySelectorAll('.slide-menu-item').forEach((m, i) => m.classList.toggle('active', i === current));

      // Update nav gradient based on progress
      const progressPercent = (current / (total - 1)) * 100;
      const transitionPoint = Math.max(0, progressPercent - 15);
      nav.style.background = 'linear-gradient(90deg, #1e40af 0%, #1e40af ' + transitionPoint + '%, #3b82f6 ' + progressPercent + '%, #93c5fd 100%)';

      counter.textContent = (current + 1) + ' / ' + total;

      // Auto-scroll menu to active item
      const activeMenuItem = slideMenu.children[current];
      if(activeMenuItem) {
        activeMenuItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }

    function goTo(index) {
      if(index >= 0 && index < total) {
        current = index;
        update();
      }
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    document.addEventListener('keydown', e => {
      if(e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if(e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    });
  </script>
</body>
</html>`;
}

module.exports = { generatePresentationHTML, extractSectionsFromReport, extractReportTitle, extractReportSubtitle };
