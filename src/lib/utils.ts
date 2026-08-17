export function sliceMasterScript(script: string, maxWords: number = 15, aggressiveSplitting: boolean = false): string[] {
  if (!script) return [];

  // Clean up whitespace and newlines
  const cleanScript = script.replace(/\s+/g, ' ').trim();

  // 1. Primary Split by terminal punctuation
  const rawSentences = cleanScript.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [cleanScript];
  const finalSlices: string[] = [];

  for (let sentence of rawSentences) {
    sentence = sentence.trim();
    if (!sentence) continue;

    const words = sentence.split(/\s+/);

    if (words.length <= maxWords && !aggressiveSplitting) {
      finalSlices.push(sentence);
    } else {
      // 2. Secondary Split by punctuation
      const splitRegex = aggressiveSplitting 
        ? /(?<=,|;|:|—|\band\b|\bor\b)\s+|(?=—)/i 
        : /(?<=,|;|:|—)\s+|(?=—)/;
      
      const clauses = sentence.split(splitRegex).map(s => s.trim()).filter(Boolean);
      
      let currentChunk = "";

      for (const clause of clauses) {
        const potentialChunk = currentChunk ? `${currentChunk} ${clause}` : clause;
        
        if (potentialChunk.split(/\s+/).length <= maxWords && !aggressiveSplitting) {
          currentChunk = potentialChunk;
        } else {
          if (currentChunk) {
            finalSlices.push(currentChunk);
            currentChunk = "";
          }
          
          // 3. Intelligent Semantic Fallback
          let remainingClause = clause;
          while (remainingClause.split(/\s+/).length > maxWords) {
            const clauseWords = remainingClause.split(/\s+/);
            
            // Look for a natural grammatical break point
            let splitIndex = Math.floor(maxWords * 0.8); // Default fallback
            const breakWords = ["and", "but", "or", "because", "that", "which", "with", "in", "on", "at", "to", "from", "by", "as", "for"];
            
            for (let i = maxWords - 1; i >= Math.floor(maxWords / 2); i--) {
              if (breakWords.includes(clauseWords[i]?.toLowerCase() || "")) {
                splitIndex = i;
                break;
              }
            }
            // Ensure we don't get stuck in an infinite loop if maxWords is very small
            if (splitIndex === 0) splitIndex = maxWords;
            
            finalSlices.push(clauseWords.slice(0, splitIndex).join(" "));
            remainingClause = clauseWords.slice(splitIndex).join(" ");
          }
          currentChunk = remainingClause;
        }
      }
      if (currentChunk) {
        finalSlices.push(currentChunk);
      }
    }
  }
  
  return finalSlices;
}
