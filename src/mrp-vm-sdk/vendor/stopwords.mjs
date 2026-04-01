// Minimal English stopwords list (vendored)
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for',
  'of','with','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','shall',
  'should','may','might','must','can','could','i','me','my',
  'we','our','you','your','he','him','his','she','her','it',
  'its','they','them','their','this','that','these','those',
  'am','not','no','nor','so','if','then','than','too','very',
  'just','about','above','after','again','all','also','any',
  'because','before','below','between','both','by','down',
  'during','each','few','from','further','get','got','here',
  'how','into','more','most','now','only','other','out','over',
  'own','same','some','such','there','through','under','until',
  'up','what','when','where','which','while','who','whom','why'
]);

export function isStopword(word) {
  return STOPWORDS.has(word.toLowerCase());
}

export { STOPWORDS };
