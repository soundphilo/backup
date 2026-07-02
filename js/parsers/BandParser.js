// parsers/BandParser.js
// 네이버 밴드 채팅 내보내기 파서
// 형식1 (콜론): 2025년 12월 8일 오후 10:54:고라니:메시지
// 형식2 (공백): 2025년 12월 8일 오후 10:54 고라니 메시지

class BandParser {
  constructor() {
    this.name = 'band';
    this.label = '밴드';

    // 형식1: 콜론 구분 (사용자명에 공백 없음)
    this._regexColon = /^(\d{4}년\s*(?:0?[1-9]|1[0-2])월\s*(?:0?[1-9]|[12][0-9]|3[01])일\s*(?:오전|오후)\s*(?:0?[1-9]|1[0-2]):[0-5][0-9]):([^:]+):(.+)$/;

    // 형식2: 공백 구분 — 사용자명을 마지막 단어들로 파악하기 어려우므로
    // 타임스탬프 이후 첫 번째 공백-비공백 덩어리를 이름으로 취급
    this._regexSpace = /^(\d{4}년\s*(?:0?[1-9]|1[0-2])월\s*(?:0?[1-9]|[12][0-9]|3[01])일\s*(?:오전|오후)\s*(?:0?[1-9]|1[0-2]):[0-5][0-9])\s+(\S+(?:\s+\S+)*?)\s{2,}(.+)$|^(\d{4}년\s*(?:0?[1-9]|1[0-2])월\s*(?:0?[1-9]|[12][0-9]|3[01])일\s*(?:오전|오후)\s*(?:0?[1-9]|1[0-2]):[0-5][0-9])\s+([^\s].+?)\s{1}(.+)$/;

    // 타임스탬프 패턴 (canParse 감지용)
    this._timestampPattern = /\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2}/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    const lines = text.split('\n').slice(0, 30);
    const matches = lines.filter(l => this._timestampPattern.test(l.trim()));
    return matches.length >= 2;
  }

  parse(chatData) {
    const lines = chatData.split('\n');
    let currentMessage = null;
    const messages = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 형식1 시도
      let match = line.match(this._regexColon);
      if (match) {
        if (currentMessage) messages.push(currentMessage);
        currentMessage = {
          time: match[1].trim(),
          username: match[2].trim(),
          chatMessage: match[3].trim(),
        };
        continue;
      }

      // 형식2 시도 — 타임스탬프가 있으면 분리 시도
      if (this._timestampPattern.test(line)) {
        const tsMatch = line.match(/^(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2})\s+(.+)$/);
        if (tsMatch) {
          const rest = tsMatch[2];
          // rest = "이름 메시지" — 이름은 첫 토큰들, 나머지가 메시지
          // 밴드 공백 형식은 이름이 단어 하나인 경우가 많음
          const spaceIdx = rest.indexOf(' ');
          if (spaceIdx !== -1) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = {
              time: tsMatch[1].trim(),
              username: rest.substring(0, spaceIdx).trim(),
              chatMessage: rest.substring(spaceIdx + 1).trim(),
            };
            continue;
          }
        }
      }

      // 연속 줄
      if (currentMessage) {
        currentMessage.chatMessage += '\n' + line;
      }
    }

    if (currentMessage) messages.push(currentMessage);
    return messages;
  }
}