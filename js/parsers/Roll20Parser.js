// js/parsers/Roll20Parser.js
// Roll20 textchatcontainer HTML 파서
// 사용법: F12 → #textchat div 우클릭 → Copy outerHTML → 붙여넣기

class Roll20Parser {
  constructor() {
    this.name  = 'roll20';
    this.label = '롤20';
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    return (
      text.includes('textchatcontainer') ||
      text.includes('class="message general') ||
      text.includes('class="message desc') ||
      (text.includes('class="message') && text.includes('tstamp'))
    );
  }

  parse(chatData) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(chatData, 'text/html');
    const msgs   = doc.querySelectorAll('.message');

    const messages  = [];
    let lastSpeaker = null;
    let lastTime    = null;
    let lastAvatar  = null;

    for (const div of msgs) {
      if (div.classList.contains('hidden-message')) continue;

      // ── GM 지문 (desc) ──────────────────────────────────────
      if (div.classList.contains('desc')) {
        const html = this._extractDescHtml(div);
        if (!html) continue;
        // chatMessage는 순수 텍스트로 (편집 시 기본 표시용)
        const descText = div.textContent.replace(/\s+/g, ' ').trim();
        messages.push({
          time:        lastTime || '',
          username:    'GM',
          chatMessage: descText || html,
          rawHtml:     html,
          isDesc:      true,
          msgType:     'desc',
        });
        continue;
      }

      // ── 일반 발언 (general) ─────────────────────────────────
      if (div.classList.contains('general')) {
        const byEl  = div.querySelector('.by');
        const tsEl  = div.querySelector('.tstamp');
        const imgEl = div.querySelector('.avatar img');

        const speaker = byEl  ? byEl.textContent.replace(/:$/, '').trim() : lastSpeaker;
        const time    = tsEl  ? tsEl.textContent.trim()                   : lastTime;

        // byEl이 있는 메시지에서만 avatar 갱신 — 연속 메시지 imgEl 혼입 방지
        if (byEl && speaker) {
          lastSpeaker = speaker;
          lastTime    = time;
          lastAvatar  = imgEl ? imgEl.getAttribute('src') : null;
        }
        const avatar = lastAvatar;

        // CoC 공격 템플릿 — 단일 (coc-attack-1)
        const cocAttackTable = div.querySelector('.sheet-rolltemplate-coc-attack-1');
        if (cocAttackTable) {
          const rollHtml = this._extractCocAttackHtml(cocAttackTable);
          if (rollHtml) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: rollHtml, rawHtml: rollHtml,
              isDesc: false, msgType: 'roll',
            });
          }
          const extra = this._extractPlainText(div);
          if (extra) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: extra, rawHtml: null,
              isDesc: false, msgType: 'text',
            });
          }
          continue;
        }

        // CoC 공격 템플릿 — 보너스 (coc-attack, -1 없음)
        const cocAttackBonusTable = div.querySelector('.sheet-rolltemplate-coc-attack:not(.sheet-rolltemplate-coc-attack-1)');
        if (cocAttackBonusTable) {
          const rollHtml = this._extractCocAttackBonusHtml(cocAttackBonusTable);
          if (rollHtml) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: rollHtml, rawHtml: rollHtml,
              isDesc: false, msgType: 'roll',
            });
          }
          continue;
        }

        // CoC 보너스/패널티 주사위 (sheet-rolltemplate-coc, -1 없음)
        const cocBonusTable = div.querySelector('.sheet-rolltemplate-coc:not(.sheet-rolltemplate-coc-1):not(.sheet-rolltemplate-coc-attack-1)');
        if (cocBonusTable) {
          const rollHtml = this._extractCocBonusHtml(cocBonusTable);
          if (rollHtml) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: rollHtml, rawHtml: rollHtml,
              isDesc: false, msgType: 'roll',
            });
            // 카드 정상 생성 시 extra 텍스트는 버림
            // (HTML 파싱 오류로 td가 template div 밖에 남아 텍스트로 중복 출력되는 현상 방지)
          }
          continue;
        }

        // 알려진 CoC 단일 주사위 템플릿 (sheet-rolltemplate-coc-1)
        const cocTable = div.querySelector('.sheet-rolltemplate-coc-1');
        if (cocTable) {
          const rollHtml = this._extractCocRollHtml(cocTable);
          if (rollHtml) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: rollHtml, rawHtml: rollHtml,
              isDesc: false, msgType: 'roll',
            });
          }
          // 롤 외 텍스트
          const extra = this._extractPlainText(div);
          if (extra) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: extra, rawHtml: null,
              isDesc: false, msgType: 'text',
            });
          }
          continue;
        }

        // 미지원 커스텀 주사위 템플릿 — 원본 테이블 HTML 보존
        const anyTemplate = div.querySelector('[class*="sheet-rolltemplate-"]');
        if (anyTemplate) {
          const safeHtml = this._extractUnknownRollHtml(anyTemplate);
          messages.push({
            time, username: speaker || '', avatarUrl: avatar || null,
            chatMessage: safeHtml, rawHtml: safeHtml,
            isDesc: false, msgType: 'roll-unknown',
          });
          const extra = this._extractPlainText(div);
          if (extra) {
            messages.push({
              time, username: speaker || '', avatarUrl: avatar || null,
              chatMessage: extra, rawHtml: null,
              isDesc: false, msgType: 'text',
            });
          }
          continue;
        }

        // 인라인 롤 (단독)
        const inlineRoll = div.querySelector('.inlinerollresult');
        if (inlineRoll) {
          const rollVal   = inlineRoll.textContent.trim();
          const extraText = this._extractPlainText(div);
          const combined  = extraText
            ? `${this._esc(extraText)} <span class="r20-inline-roll">${this._esc(rollVal)}</span>`
            : `<span class="r20-inline-roll">${this._esc(rollVal)}</span>`;
          messages.push({
            time, username: speaker || '', avatarUrl: avatar || null,
            chatMessage: combined, rawHtml: combined,
            isDesc: false, msgType: 'inline-roll',
          });
          continue;
        }

        // 일반 텍스트: chatMessage는 순수 텍스트, rawHtml은 HTML
        const html = this._extractGeneralHtml(div);
        if (!html) continue;
        const plainText = this._extractPlainText(div) || html;
        messages.push({
          time, username: speaker || '', avatarUrl: avatar || null,
          chatMessage: plainText, rawHtml: html,
          isDesc: false, msgType: 'text',
        });
      }
    }

    return messages;
  }

  // ── desc 지문: _nodeToHtml 방식으로 인라인 스타일 보존 ────────
  _extractDescHtml(div) {
    // spacer 제거
    const clone = div.cloneNode(true);
    clone.querySelectorAll('.spacer').forEach(el => el.remove());
    const html = this._nodeToHtml(clone, true).trim();
    return html || null;
  }

  // ── 일반 발언: em/strong/a + 인라인 스타일 보존 ──────────────
  _extractGeneralHtml(div) {
    const clone = div.cloneNode(true);
    for (const sel of ['.avatar', '.tstamp', '.by', '.spacer',
                       '[class*="sheet-rolltemplate-"]', '.inlinerollresult']) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }
    return this._nodeToHtml(clone, false).trim() || null;
  }

  // ── 텍스트만 (롤 테이블 제외) ────────────────────────────────
  _extractPlainText(div) {
    const clone = div.cloneNode(true);
    for (const sel of ['.avatar', '.tstamp', '.by', '.spacer',
                       '[class*="sheet-rolltemplate-"]', '.inlinerollresult']) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }
    return clone.textContent.trim() || null;
  }

  // ── CoC 공격 테이블 (기준치/굴림/판정결과/피해) ───────────────
  _extractCocAttackHtml(tbl) {
    const caption = tbl.querySelector('caption')?.textContent.trim() || '';
    const rows    = tbl.querySelectorAll('tr');
    let base = '', rolled = '', resultText = '', resultKey = '', resultBg = '#6b7280', damage = '';

    for (const row of rows) {
      const labelEl = row.querySelector('.sheet-template_label');
      const label   = labelEl?.getAttribute('data-i18n') || labelEl?.textContent.trim() || '';
      const valEl   = row.querySelector('.sheet-template_value');
      if (!valEl) continue;

      // 기준치/굴림: inlinerollresult 여러 개면 / 로 연결
      const inlineRolls = valEl.querySelectorAll('.inlinerollresult');
      const val = inlineRolls.length
        ? [...inlineRolls].map(el => el.textContent.trim()).join(' / ')
        : valEl.textContent.trim();

      if (label === 'value' || label.includes('기준치'))       base       = val;
      else if (label === 'rolled' || label.includes('굴림'))   rolled     = val;
      else if (label === 'result' || label.includes('판정결과')) {
        resultText = valEl.textContent.trim();
        const valStyle = valEl.getAttribute('style') || '';
        const styleBg  = valStyle.match(/background(?:-color)?:\s*([^;]+)/i)?.[1]?.trim();
        const inner    = valEl.querySelector('[data-i18n]');
        resultKey      = inner?.getAttribute('data-i18n') || '';
        resultBg       = styleBg ? this._normalizeCssColor(styleBg)
                       : (this._resultColor(resultKey) || this._resultColorFromText(resultText) || '#6b7280');
      }
      else if (label === 'dam' || label.includes('피해'))       damage     = val;
    }

    if (!rolled) return null;

    const isCrit = resultKey === 'critical';

    return `<div class="r20-roll">
  <div class="r20-roll-caption">${this._esc(caption)}</div>
  <div class="r20-roll-row"><span class="r20-roll-label">기준치</span><span class="r20-roll-val">${this._esc(base)}</span></div>
  <div class="r20-roll-row"><span class="r20-roll-label">굴림</span><span class="r20-roll-num${isCrit ? ' r20-crit' : ''}">${this._esc(rolled)}</span></div>
  <div class="r20-roll-result" style="background:${resultBg}">${this._esc(resultText)}</div>
  ${damage ? `<div class="r20-roll-row"><span class="r20-roll-label">피해</span><span class="r20-roll-val" style="font-weight:700;color:#fff">${this._esc(damage)}</span></div>` : ''}
</div>`;
  }

  // ── CoC 보너스 공격 주사위 (coc-attack, 다중 결과 행 + 피해) ──
  _extractCocAttackBonusHtml(tbl) {
    const caption  = tbl.querySelector('caption')?.textContent.trim() || '';
    const ROW_DEFAULTS = ['#dff0d8', '#d9edf7', '#d3d3d3', '#fcf8e3', '#f2dede'];

    const allLabels = [...tbl.querySelectorAll('td.sheet-template_label')];
    const allValues = [...tbl.querySelectorAll('td.sheet-template_value')];
    if (!allLabels.length || !allValues.length) return null;

    let base = '', rolled = '', damage = '';
    const resultRows = [];

    for (let i = 0; i < allLabels.length; i++) {
      const labelEl  = allLabels[i];
      const valEl    = allValues[i];
      if (!valEl) continue;

      const labelKey   = labelEl.getAttribute('data-i18n') || '';
      const labelTxt   = labelEl.textContent.trim().replace(/\u00a0/g, ' ').trim();
      const cleanLabel = labelTxt.replace(/[\s\u00a0\u3000]/g, '');

      const inlineRolls = valEl.querySelectorAll('.inlinerollresult');
      const val = inlineRolls.length
        ? [...inlineRolls].map(el => el.textContent.trim()).join(', ')
        : valEl.textContent.trim();

      const isBase   = labelKey === 'value'  || labelTxt.includes('기준치');
      const isRolled = labelKey === 'rolled' || labelTxt.includes('굴림');
      const isDamage = labelKey === 'dam'    || labelTxt.includes('피해');
      const isResult = /^[+\-]?\d+:?$/.test(cleanLabel)
                    || labelKey === 'result' || labelTxt.includes('판정결과');

      if (isBase)        base   = val;
      else if (isRolled) rolled = val;
      else if (isDamage) damage = val;
      else if (isResult) {
        const rText = valEl.textContent.trim();
        if (!rText) continue;
        const rBg   = ROW_DEFAULTS[resultRows.length % ROW_DEFAULTS.length];
        const prefix = cleanLabel.replace(/:$/, '');
        resultRows.push({ rText, rBg, prefix });
      }
    }

    if (!resultRows.length) return null;

    const resultHtml = resultRows.map(r =>
      `<div class="r20-roll-result r20-roll-result-multi" style="background:${r.rBg}">` +
      `<span class="r20-roll-result-prefix" style="color:#1a1a1a;font-weight:600">${this._esc(r.prefix)}</span>` +
      `<span style="color:#1a1a1a;font-weight:600">${this._esc(r.rText)}</span></div>`
    ).join('');

    return `<div class="r20-roll">
  <div class="r20-roll-caption">${this._esc(caption)}</div>
  <div class="r20-roll-row"><span class="r20-roll-label">기준치</span><span class="r20-roll-val">${this._esc(base)}</span></div>
  <div class="r20-roll-row"><span class="r20-roll-label">굴림</span><span class="r20-roll-num">${this._esc(rolled)}</span></div>
  ${resultHtml}
  ${damage ? `<div class="r20-roll-row"><span class="r20-roll-label">피해</span><span class="r20-roll-val" style="font-weight:700;color:#fff">${this._esc(damage)}</span></div>` : ''}
</div>`;
  }

  // ── CoC 보너스/패널티 주사위 전용 ────────────────────────────
  _extractCocBonusHtml(tbl) {
    const caption = tbl.querySelector('caption')?.textContent.trim() || '';
    const ROW_DEFAULTS = ['#dff0d8', '#d9edf7', '#d3d3d3', '#fcf8e3', '#f2dede'];

    // tr 단위 파싱 대신 label/value 셀을 tbody에서 직접 수집
    // (불규칙한 HTML 파싱으로 td가 tr 밖으로 밀려나는 경우 대응)
    const allLabels = [...tbl.querySelectorAll('td.sheet-template_label')];
    const allValues = [...tbl.querySelectorAll('td.sheet-template_value')];

    if (!allLabels.length || !allValues.length) return null;

    let base = '', rolled = '';
    const resultRows = [];

    for (let i = 0; i < allLabels.length; i++) {
      const labelEl  = allLabels[i];
      const valEl    = allValues[i];
      if (!valEl) continue;

      const labelKey = labelEl.getAttribute('data-i18n') || '';
      const labelTxt = labelEl.textContent.trim().replace(/\u00a0/g, ' ').trim();
      const cleanLabel = labelTxt.replace(/[\s\u00a0\u3000]/g, '');

      const inlineRolls = valEl.querySelectorAll('.inlinerollresult');
      const val = inlineRolls.length
        ? [...inlineRolls].map(el => el.textContent.trim()).join(', ')
        : valEl.textContent.trim();

      const isBase   = labelKey === 'value'  || labelTxt.includes('기준치');
      const isRolled = labelKey === 'rolled' || labelTxt.includes('굴림');
      const isResult = /^[+\-]?\d+:?$/.test(cleanLabel)
                    || labelKey === 'result' || labelTxt.includes('판정결과');

      if (isBase)        base   = val;
      else if (isRolled) rolled = val;
      else if (isResult) {
        const rText = valEl.textContent.trim();
        if (!rText) continue;

        const rBg = ROW_DEFAULTS[resultRows.length % ROW_DEFAULTS.length];
        const prefix = cleanLabel.replace(/:$/, '');
        resultRows.push({ rText, rBg, prefix });
      }
    }

    if (!resultRows.length) return null;

    const resultHtml = resultRows.map(r =>
      `<div class="r20-roll-result r20-roll-result-multi" style="background:${r.rBg}">` +
      `<span class="r20-roll-result-prefix" style="color:#1a1a1a;font-weight:600">${this._esc(r.prefix)}</span>` +
      `<span style="color:#1a1a1a;font-weight:600">${this._esc(r.rText)}</span></div>`
    ).join('');

    return `<div class="r20-roll">
  <div class="r20-roll-caption">${this._esc(caption)}</div>
  <div class="r20-roll-row"><span class="r20-roll-label">기준치</span><span class="r20-roll-val">${this._esc(base)}</span></div>
  <div class="r20-roll-row"><span class="r20-roll-label">굴림</span><span class="r20-roll-num">${this._esc(rolled)}</span></div>
  ${resultHtml}
</div>`;
  }

  // ── CoC 단일 주사위 (coc-1) ──────────────────────────────────
  _extractCocRollHtml(tbl) {
    const caption = tbl.querySelector('caption')?.textContent.trim() || '';
    const rows    = tbl.querySelectorAll('tr');
    let base = '', rolled = '', resultText = '', resultBg = '#6b7280';

    for (const row of rows) {
      const labelEl  = row.querySelector('.sheet-template_label');
      const labelKey = labelEl?.getAttribute('data-i18n') || '';
      const labelTxt = labelEl?.textContent.trim() || '';
      const valEl    = row.querySelector('.sheet-template_value');
      if (!valEl) continue;

      const inlineRolls = valEl.querySelectorAll('.inlinerollresult');
      const val = inlineRolls.length
        ? [...inlineRolls].map(el => el.textContent.trim()).join(' / ')
        : valEl.textContent.trim();

      const isBase   = labelKey === 'value'  || labelTxt.includes('기준치');
      const isRolled = labelKey === 'rolled' || labelTxt.includes('굴림');
      const isResult = labelKey === 'result' || labelTxt.includes('판정결과');

      if (isBase)        base   = val;
      else if (isRolled) rolled = val;
      else if (isResult) {
        resultText = valEl.textContent.trim();
        const valStyle = valEl.getAttribute('style') || '';
        const styleBg  = valStyle.match(/background(?:-color)?:\s*([^;]+)/i)?.[1]?.trim();
        const inner    = valEl.querySelector('[data-i18n]');
        const i18nKey  = inner?.getAttribute('data-i18n') || '';
        resultBg = styleBg
          ? this._normalizeCssColor(styleBg)
          : (this._resultColor(i18nKey) || this._resultColorFromText(resultText) || '#6b7280');
      }
    }

    if (!rolled && !resultText) return null;

    return `<div class="r20-roll">
  <div class="r20-roll-caption">${this._esc(caption)}</div>
  <div class="r20-roll-row"><span class="r20-roll-label">기준치</span><span class="r20-roll-val">${this._esc(base)}</span></div>
  <div class="r20-roll-row"><span class="r20-roll-label">굴림</span><span class="r20-roll-num">${this._esc(rolled)}</span></div>
  <div class="r20-roll-result" style="background:${resultBg}">${this._esc(resultText)}</div>
</div>`;
  }

  // 텍스트 내용으로 색상 추론 (style/data-i18n 둘 다 없을 때 폴백)
  _resultColorFromText(text) {
    if (!text) return null;
    const t = text.trim();
    if (t.includes('대성공') || t.includes('크리티컬')) return '#00ff00';
    if (t.includes('극단적')) return '#86efac';
    if (t.includes('어려운')) return '#4ade80';
    if (t.includes('보통 성공') || t.includes('성공')) return '#15803d';
    if (t.includes('대실패') || t.includes('펌블'))    return '#ff0000';
    if (t.includes('실패'))                            return '#b91c1c';
    return null;
  }

  // CSS 색상명 → 헥스 정규화
  _normalizeCssColor(color) {
    if (!color) return null;
    const c = color.trim().toLowerCase();
    const named = {
      // Roll20이 실제로 사용하는 색상명
      'darkgreen':   '#15803d', // 보통 성공
      'green':       '#4ade80', // 어려운 성공
      'lightgreen':  '#86efac', // 극단적 성공
      'lime':        '#00ff00', // 대성공
      'limegreen':   '#00ff00',
      'yellowgreen': '#86efac',
      // 빨강 계열
      'crimson':     '#b91c1c', // 실패
      'red':         '#ff0000', // 대실패
      'darkred':     '#b91c1c',
      'firebrick':   '#b91c1c',
      // 회색
      '#bebebe':     '#9ca3af',
      'gray':        '#9ca3af',
      'grey':        '#9ca3af',
      'silver':      '#9ca3af',
      'lightgray':   '#d1d5db',
      'lightgrey':   '#d1d5db',
      'darkgray':    '#6b7280',
      'darkgrey':    '#6b7280',
      // 기타
      'orange':      '#f97316',
      'goldenrod':   '#d97706',
      'gold':        '#eab308',
    };
    return named[c] || color;
  }

  // data-i18n → 배경색 폴백
  _resultColor(key) {
    const map = {
      'critical':    '#00ff00', // 대성공     — 원색 초록
      'extreme':     '#86efac', // 극단적 성공 — 연한 연두
      'hard':        '#4ade80', // 어려운 성공 — 진한 연두
      'success':     '#15803d', // 보통 성공   — 다크그린
      'fail':        '#b91c1c', // 실패        — 진한 빨강
      'failure':     '#b91c1c', // 실패        — 진한 빨강
      'fumble':      '#ff0000', // 대실패      — 원색 빨강
      '대성공':      '#00ff00',
      '극단적 성공': '#86efac',
      '어려운 성공': '#4ade80',
      '보통 성공':   '#15803d',
      '실패':        '#b91c1c',
      '대실패':      '#ff0000',
    };
    return map[key?.trim()] || null;
  }

  // ── 미지원 템플릿: 원본 테이블을 안전하게 보존 ───────────────
  _extractUnknownRollHtml(el) {
    // 위험 속성/스크립트 제거 후 테이블 구조 유지
    const clone = el.cloneNode(true);
    // script, on* 이벤트 제거
    clone.querySelectorAll('script').forEach(s => s.remove());
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const attrs = [...node.attributes];
      for (const attr of attrs) {
        if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
        if (attr.name === 'style') {
          node.setAttribute('style', this._sanitizeStyle(attr.value));
        }
      }
      node = walker.nextNode();
    }
    return `<div class="r20-roll-unknown">${clone.outerHTML}</div>`;
  }

  // ── 노드 → HTML (인라인 스타일 보존 옵션) ───────────────────
  _nodeToHtml(node, preserveStyle = false) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += this._esc(child.textContent);
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        const style = preserveStyle ? this._sanitizeStyle(child.getAttribute('style') || '') : '';
        const styleAttr = style ? ` style="${style}"` : '';

        if (tag === 'em')     out += `<em>${this._nodeToHtml(child, preserveStyle)}</em>`;
        else if (tag === 'strong') out += `<strong>${this._nodeToHtml(child, preserveStyle)}</strong>`;
        else if (tag === 'a') {
          const href = child.getAttribute('href') || '';
          const inner = this._nodeToHtml(child, preserveStyle);
          if (href && href !== '#' && /^https?:\/\//.test(href)) {
            out += `<a href="${this._esc(href)}" target="_blank" rel="noopener"${styleAttr}>${inner}</a>`;
          } else if (style) {
            out += `<span${styleAttr}>${inner}</span>`;
          } else {
            out += inner;
          }
        }
        else if (tag === 'br') out += '<br>';
        else if (tag === 'img') {
          const src = child.getAttribute('src') || '';
          if (src && !src.startsWith('data:')) {
            // desc(preserveStyle=true)에서는 이미지 크기 제한 없음
            // general(preserveStyle=false)에서는 240px 제한
            const imgStyle = preserveStyle
              ? 'max-width:100%;display:inline-block;border-radius:4px;margin:4px 0'
              : 'max-width:240px;max-height:240px;border-radius:4px;display:inline-block;margin-top:4px;vertical-align:top';
            out += `<img src="${this._esc(src)}" style="${imgStyle}" alt="">`;
          }
        }
        else if (tag === 'span') {
          out += style ? `<span${styleAttr}>${this._nodeToHtml(child, preserveStyle)}</span>`
                       : this._nodeToHtml(child, preserveStyle);
        }
        else {
          out += this._nodeToHtml(child, preserveStyle);
        }
      }
    }
    return out;
  }

  // ── 허용된 CSS 속성만 통과 ──────────────────────────────────
  _sanitizeStyle(style) {
    if (!style) return '';
    const allowed = ['color','font-size','font-weight','font-style',
                     'background','background-color','background-image',
                     'text-decoration','text-align','letter-spacing',
                     'padding','border-radius','display','border',
                     'box-shadow','line-height','margin-left'];
    return style.split(';')
      .map(s => s.trim())
      .filter(s => {
        if (!s) return false;
        const prop = s.split(':')[0].trim().toLowerCase();
        // position:absolute 같은 레이아웃 속성 차단
        if (['position','top','left','right','bottom','width','height',
             'z-index','overflow','pointer-events'].includes(prop)) return false;
        return allowed.some(a => prop.startsWith(a));
      })
      .join(';');
  }

  _esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}