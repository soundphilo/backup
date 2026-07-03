class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [2026. 1. 7. 오후 12:59] 유저네임 형식 확실하게 매칭
    this._regexTimestamp = /^\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}|\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\]\s+(.+?)(?:\s+\(pinned\))?$/;
    
    // 헤더 구분선 매칭
    this._separator = /^={5,}$/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    
    const cleanedText = text.replace(/^\s+/, '').replace(/\r\n/g, '\n');
    const lines = cleanedText.split('\n').slice(0, 30);

    const hasSeparator = lines.some(l => this._separator.test(l.trim()));
    const hasGuild = lines.some(l => {
      const trimmed = l.trim();
      return trimmed.startsWith('Guild:') || trimmed.startsWith('Channel:');
    });

    const hasTS = lines.some(l => this._regexTimestamp.test(l.trim()));

    return (hasSeparator && hasGuild) || hasTS;
  }

  parse(chatData) {
    const cleanedData = chatData.replace(/^\s+/, '').replace(/\r\n/g, '\n');
    const lines = cleanedData.split('\n');
    
    const messages = [];
    let currentMessage = null;

    // 헬퍼 함수 정의: 현재까지 누적된 메시지를 결과 배열에 안전하게 밀어넣음
    const saveCurrentMessage = () => {
      if (currentMessage) {
        // 메시지 본문의 앞뒤 공백을 깔끔하게 정리하되, 알맹이가 있을 때만 추가
        currentMessage.chatMessage = currentMessage.chatMessage.trim();
        if (currentMessage.chatMessage) {
          messages.push(currentMessage);
        }
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // 1. 헤더 구분선이거나 빈 줄이면 가볍게 건너뜁니다.
      if (this._separator.test(line) || !line) {
        // 단, 빈 줄이 메시지 본문 중간에 나온 거라면 줄바꿈을 유지해 줍니다.
        if (!line && currentMessage && currentMessage.chatMessage) {
          currentMessage.chatMessage += '\n';
        }
        continue;
      }

      // 2. 타임스탬프 라인 매칭 = 새 메시지 시작
      const tsMatch = line.match(this._regexTimestamp);
      if (tsMatch) {
        // 새 유저가 등장했으니, 기존에 쌓고 있던 유저의 메시지를 배열에 저장합니다.
        saveCurrentMessage();
        
        // 새로운 메시지 바구니 생성
        currentMessage = {
          time: tsMatch[1].trim(),
          username: tsMatch[2].trim(),
          chatMessage: '',
        };
        continue;
      }

      // 3. 아직 타임스탬프를 한 번도 안 만났다면 (즉, 맨 위 헤더 정보 구간이라면) 무시하고 넘어갑니다.
      if (!currentMessage) continue;
        
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // 4. 메타 정보 라인 스킵
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        continue;
      }

      // 5. 진짜 대화 본문 텍스트 누적
      if (currentMessage.chatMessage) {
        currentMessage.chatMessage += '\n' + line;
      } else {
        currentMessage.chatMessage = line;
      }
    }

    // 루프가 끝난 후, 미처 저장되지 못하고 남아있는 마지막 메시지까지 싹 털어서 넣어줍니다.
    saveCurrentMessage();

    return messages;
  }
}
