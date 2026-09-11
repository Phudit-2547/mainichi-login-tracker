import fs from 'node:fs';

const path = '.github/scripts/apply-archive-feature.mjs';
let source = fs.readFileSync(path, 'utf8');

function repairTemplateBlock(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing ${label} start`);
  const bodyStart = start + startMarker.length;
  const end = source.indexOf(endMarker, bodyStart);
  if (end === -1) throw new Error(`Missing ${label} end`);

  let body = source.slice(bodyStart, end);
  body = body
    .replace(/(^|[^\\])`/g, '$1\\`')
    .replace(/(^|[^\\])\$\{/g, '$1\\${');
  source = source.slice(0, bodyStart) + body + source.slice(end);
}

repairTemplateBlock('const renderSidebar = `', '\n`;\nhtml = replaceUntil(html, \'function renderSidebar() {\'', 'renderSidebar');
repairTemplateBlock('const renderMain = `', '\n`;\nhtml = replaceUntil(html, \'function renderMain() {\'', 'renderMain');
repairTemplateBlock('const setViewTitle = `', '\n`;\nhtml = replaceUntil(html, \'function setViewTitle(\'', 'setViewTitle');
repairTemplateBlock('const renderGameCard = `', '\n`;\nhtml = replaceUntil(html, \'function renderGameCard(g) {\'', 'renderGameCard');
repairTemplateBlock('const renderEmpty = `', '\n`;\nhtml = replaceUntil(html, \'function renderEmpty() {\'', 'renderEmpty');
repairTemplateBlock('const collectDueGames = `', '\n`;\nnotify = replaceOnce(', 'collectDueGames');
repairTemplateBlock("fs.writeFileSync('tests/archive.test.mjs', `", '\n`);\n\nconsole.log(\'Archive feature applied.\');', 'archive tests');

fs.writeFileSync(path, source);
