class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // 기존 영문 형식 및 새로운 한국어 날짜/시간 형식[2026. 1. 7. 오후 12:59] 모두 대응
    // 그룹 1: 타임스탬프 문자열, 그룹 2: 사용자명
    this._regexTimestamp = /^\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}|\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\]\s+(.+?)(?:\s+\(pinned\))?$/;

    // 헤더 구분선
    this._separator = /^={10,}$/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    const lines = text.split('\n').slice(0, 30);

    // 구분선 + Guild/Channel 헤더 감지
    const hasSeparator = lines.some(l => this._separator.test(l.trim()));
    const hasGuild = lines.some(l => l.startsWith('Guild:') || l.startsWith('Channel:'));

    // 타임스탬프 형식 감지 (한국어 패턴인 `[연도.` 형식도 조건에 추가)
    const tsPattern = /^\[(?:\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}|\d{4}\.\s*\d{1,2}\.)/;
    const hasTS = lines.some(l => tsPattern.test(l.trim()));

    return (hasSeparator && hasGuild) || hasTS;
  }

  parse(chatData) {
    const lines = chatData.split('\n');
    const messages = [];
    let currentMessage = null;
    let inHeader = true;
    let headerDone = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // 헤더 구간 처리 (첫 두 개의 구분선 사이)
      if (this._separator.test(line)) {
        headerDone++;
        if (headerDone >= 2) inHeader = false;
        continue;
      }
      if (inHeader) continue;

      // "Exported N message(s)" 꼬리말
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // 타임스탬프 라인 = 새 메시지 시작
      const tsMatch = line.match(this._regexTimestamp);
      if (tsMatch) {
        if (currentMessage) messages.push(currentMessage);
        currentMessage = {
          time: tsMatch[1].trim(),
          username: tsMatch[2].trim(),
          chatMessage: '',
        };
        continue;
      }

      if (!currentMessage) continue;

      // 첨부파일/이모지 반응 등 메타 라인은 메시지에 포함시키되 빈 줄로 구분
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        // 메타 정보는 스킵
        continue;
      }

      // 빈 줄: 메시지 사이 구분 (같은 화자의 연속 단락)
      if (!line) {
        if (currentMessage.chatMessage) currentMessage.chatMessage += '\n';
        continue;
      }

      // 메시지 본문 누적
      if (currentMessage.chatMessage) {
        currentMessage.chatMessage += '\n' + line;
      } else {
        currentMessage.chatMessage = line;
      }
    }

    if (currentMessage && currentMessage.chatMessage.trim()) {
      messages.push(currentMessage);
    }

    return messages;
  }
}
