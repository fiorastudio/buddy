/**
 * PostToolUse Hook for Buddy
 * Automatically triggers 'buddy_observe' after tools are used.
 */
export default async function postToolUse({ tools, results, context }) {
  // We only care about providing a summary if work was actually done.
  // Avoid spamming if it was just status checks.
  const ignoredTools = ['buddy_status', 'buddy_reasoning_status', 'buddy_doctor'];
  
  const relevantTools = tools.filter(t => !ignoredTools.includes(t.name));
  
  if (relevantTools.length > 0) {
    const summary = `Used tools: ${relevantTools.map(t => t.name).join(', ')}`;
    
    try {
      await context.callTool('buddy_observe', {
        summary: summary
      });
    } catch (err) {
      // Silently fail if tool call fails to avoid disrupting the user flow
      console.error('Buddy Observer failed:', err);
    }
  }
}
