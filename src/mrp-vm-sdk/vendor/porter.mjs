// Minimal Porter Stemmer (vendored)
// Based on the Porter stemming algorithm for English

const step2list = {
  ational:'ate', tional:'tion', enci:'ence', anci:'ance',
  izer:'ize', bli:'ble', alli:'al', entli:'ent', eli:'e',
  ousli:'ous', ization:'ize', ation:'ate', ator:'ate',
  alism:'al', iveness:'ive', fulness:'ful', ousness:'ous',
  aliti:'al', iviti:'ive', biliti:'ble', logi:'log'
};
const step3list = {
  icate:'ic', ative:'', alize:'al', iciti:'ic',
  ical:'ic', ful:'', ness:''
};
const c = '[^aeiou]';
const v = '[aeiouy]';
const C = c + '[^aeiouy]*';
const V = v + '[aeiou]*';
const mgr0 = new RegExp('^(' + C + ')?' + V + C);
const meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$');
const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C);
const s_v = new RegExp('^(' + C + ')?' + v);

export function stem(w) {
  if (w.length < 3) return w;
  let firstch;
  if (w.charAt(0) === 'y') { firstch = 'Y'; w = 'Y' + w.substr(1); }

  // Step 1a
  let re = /^(.+?)(ss|i)es$/;
  let re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) w = w.replace(re, '$1$2');
  else if (re2.test(w)) w = w.replace(re2, '$1$2');

  // Step 1b
  re = /^(.+?)eed$/;
  re2 = /^(.+?)(ed|ing)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    if (mgr0.test(fp[1])) w = w.slice(0, -1);
  } else if (re2.test(w)) {
    const fp = re2.exec(w);
    const stem = fp[1];
    if (s_v.test(stem)) {
      w = stem;
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      else if (new RegExp('^' + C + v + '[^aeiouwxy]$').test(w)) w += 'e';
    }
  }

  // Step 1c
  re = /^(.+?)y$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    if (s_v.test(fp[1])) w = fp[1] + 'i';
  }

  // Step 2
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    if (mgr0.test(fp[1])) w = fp[1] + step2list[fp[2]];
  }

  // Step 3
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    if (mgr0.test(fp[1])) w = fp[1] + step3list[fp[2]];
  }

  // Step 4
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
  re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    if (mgr1.test(fp[1])) w = fp[1];
  } else if (re2.test(w)) {
    const fp = re2.exec(w);
    if (mgr1.test(fp[1] + fp[2])) w = fp[1] + fp[2];
  }

  // Step 5
  re = /^(.+?)e$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    const stem = fp[1];
    if (mgr1.test(stem) || (meq1.test(stem) && !(new RegExp('^' + C + v + '[^aeiouwxy]$').test(stem))))
      w = stem;
  }
  if (/ll$/.test(w) && mgr1.test(w)) w = w.slice(0, -1);
  if (firstch === 'Y') w = w.charAt(0).toLowerCase() + w.substr(1);
  return w;
}
