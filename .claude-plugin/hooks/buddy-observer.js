/**
 * PostToolUse Hook for Buddy
 * Automatically triggers 'buddy_observe' after tools are used.
 */
module.exports = async function postToolUse({ tools, results, context }) {
  // We only care about providing a summary if work was actually done.
  // Avoid spamming if it was just status checks.
  const ignoredTools = ['buddy_status', 'buddy_reasoning_status', 'buddy_doctor', 'buddy_observe'];
  
  const relevantTools = tools.filter(t => !ignoredTools.includes(t.name));
  
  if (relevantTools.length > 0) {
    let summary = `Used tools: ${relevantTools.map(t => t.name).join(', ')}`;
    
    // Improve summary signal with a truncated snippet of ALL results
    if (results && results.length > 0) {
      let combinedResultText = results.map(res => {
        if (typeof res === 'string') return res;
        if (res && typeof res.text === 'string') return res.text;
        return '';
      }).filter(text => text.length > 0).join(' | ');
      
      if (combinedResultText) {
        const limit = 250;
        const snippet = combinedResultText.substring(0, limit).replace(/\n/g, ' ').trim();
        if (snippet) {
          summary += ` (Result: ${snippet}${combinedResultText.length > limit ? '...' : ''})`;
        }
      }
    }
    
    try {
      await context.callTool('buddy_observe', {
        summary: summary
      });
    } catch (err) {
      // Silently fail if tool call fails to avoid disrupting the user flow
      if (process.env.BUDDY_DEBUG) {
        console.error('Buddy Observer failed:', err);
      }
    }
  }
}
