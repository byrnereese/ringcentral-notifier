import { useEffect, useRef } from 'react';
import * as AdaptiveCards from 'adaptivecards';
import MarkdownIt from 'markdown-it';

// Configure markdown processing
AdaptiveCards.AdaptiveCard.onProcessMarkdown = (text, result) => {
  const md = new MarkdownIt();
  result.outputHtml = md.render(text);
  result.didProcess = true;
};

interface CardPreviewProps {
  cardJson: string;
}

export default function CardPreview({ cardJson }: CardPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !cardJson) return;

    try {
      const adaptiveCard = new AdaptiveCards.AdaptiveCard();
      const json = JSON.parse(cardJson);
      
      // Handle array of attachments (RingCentral format) or direct card object
      let cardPayload = json;
      if (Array.isArray(json)) {
        cardPayload = json[0];
      } else if (json.attachments && Array.isArray(json.attachments)) {
        cardPayload = json.attachments[0];
      }

      adaptiveCard.parse(cardPayload);
      const renderedCard = adaptiveCard.render();
      
      containerRef.current.innerHTML = '';
      if (renderedCard) {
        containerRef.current.appendChild(renderedCard);
      }
    } catch (e) {
      containerRef.current.innerHTML = `<div class="text-red-500 p-4">Failed to render card: ${(e as Error).message}</div>`;
    }
  }, [cardJson]);

  return <div ref={containerRef} className="adaptive-card-preview bg-white p-4 rounded-lg border border-slate-200" />;
}
