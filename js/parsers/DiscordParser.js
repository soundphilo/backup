class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [2026. 1. 7. 오후 12:59] 유저네임 형식 확실하게 매칭
    // 연. 월. 일. 뒤의 미세한 공백(\s*) 및 오전/오후 뒤의 공백까지 모두 허용
    this._regexTimestamp = /^\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}|\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\]\s+(.+?)(?:\s+\(pinned\))?$/;
    
    // 헤더 구분선 매칭 (느슨하게 변경)
    this._separator = /^={5,}$/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    
    // 윈도우 줄바꿈 제거 및 첫 노이즈 청소 후 상위 100줄 검사
    const cleanedText = text.replace(/^\s+/, '').replace(/\r\n/g, '\n');
    const lines = cleanedText.split('\n').slice(0, 30);

    // 헤더 구조 감지 (앞뒤 공백 무시하도록 trim() 보완)
    const hasSeparator = lines.some(l => this._separator.test(l.trim()));
    const hasGuild = lines.some(l => {
      const trimmed = l.trim();
      return trimmed.startsWith('Guild:') || trimmed.startsWith('Channel:');
    });

    // 타임스탬프 자체 감지 (현재 정규식으로 직접 한 줄이라도 맞는지 검사)
    const hasTS = lines.some(l => this._regexTimestamp.test(l.trim()));

    // 확실한 헤더 쌍이 있거나, 바뀐 한국어 타임스탬프 문장이 하나라도 감지되면 무조건 true
    return (hasSeparator && hasGuild) || hasTS;
  }

  parse(chatData) {
    // 텍스트 전체의 줄바꿈과 맨 앞 노이즈 통일
    const cleanedData = chatData.replace(/^\s+/, '').replace(/\r\n/g, '\n');
    const lines = cleanedData.split('\n');
    
    const messages = [];
    let currentMessage = null;
    let inHeader = true;
    let headerDone = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // 1. 헤더 건너뛰기 로직
      if (this._separator.test(line)) {
        headerDone++;
        if (headerDone >= 2) inHeader = false;
        continue;
      }

      // 2. 타임스탬프 라인 매칭 = 새 메시지 시작
      const tsMatch = line.match(this._regexTimestamp);
      if (tsMatch) {
        inHeader = false; // 헤더 강제 종료 플래그
        pushCurrentMessage();
        
        currentMessage = {
          time: tsMatch[1].trim(),
          username: tsMatch[2].trim(),
          chatMessage: '',
        };
        continue;
      }

      // 첫 타임스탬프가 나오기 전의 잡다한 라인은 스킵
      if (inHeader) continue;
        
      if (line.startsWith('Exported ') && line.includes('message')) continue;
      if (!currentMessage) continue;

      // 3. 메타 정보 라인 스킵
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        continue;
      }

      // 4. 본문 누적
      if (!line) {
        if (currentMessage.chatMessage) currentMessage.chatMessage += '\n';
        continue;
      }

      if (currentMessage.chatMessage) {
        currentMessage.chatMessage += '\n' + line;
      } else {
        currentMessage.chatMessage = line;
      }
    }

    // 마지막 메시지 잔여분 추가
    if (currentMessage && currentMessage.chatMessage.trim()) {
      currentMessage.chatMessage = currentMessage.chatMessage.trim();
      messages.push(currentMessage);
    }

    return messages;
  }
}
