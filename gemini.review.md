# Audit de Specificații vs Implementare (Detalii nedocumentate în DS)

La cererea de a investiga discrepanțele dintre specificațiile din `@docs/specs` și implementarea reală din `src/`, am analizat atent codul sursă. Am descoperit că sistemul este ținut în picioare de o serie de **euristici puternice, magic-routing și hardcodări specifice testelor** care nu sunt menționate nicăieri în documentația de design (DS).

Aceste detalii "ascunse" în cod explică de ce sistemul pare să funcționeze perfect pe teste, deși specificațiile teoretice par prea simple pentru a realiza acest lucru.

Iată principalele funcționalități, fixuri și hardcodări găsite în cod, care sunt complet absente din specificații:

## 1. Magic Routing pentru KUs (`inferPhaseScopes`)
**Fișier:** `src/mrp-vm-sdk/knowledge/pragmatics.mjs`
**Situația din DS:** DS005 (Context CNL) menționează că `PhaseScopes` este un câmp CSV opțional care indică în ce fază trebuie trimisă o unitate de cunoaștere (ex: la planner, la solver, etc.). Nu explică cum se populează dacă lipsește.
**Realitatea din cod:** Codul conține o funcție masivă `inferPhaseScopes(unit)` care face parsare de text cu expresii regulate pe câmpurile unității. Dacă găsește cuvinte ca `"json"`, `"yaml"`, `"markdown"`, rutează unitatea forțat către `gs-plugin`. Dacă găsește `"validate"`, o trimite la `val-plugin`. Dacă găsește `"plan"`, `"strategy"`, merge la planner.
**De ce contează:** Sistemul pare inteligent și capabil să separe dovezile factuale de instrucțiunile de formatare, dar o face folosind un set masiv de keyword-uri ascunse în cod, nu printr-o logică semantică pură.

## 2. Hardcodări de trișare a testelor în `IntentDecomposer`
**Fișier:** `src/core/intent/decomposer.mjs`
**Situația din DS:** DS011 explică că decomposerul face o tokenizare simplă a cuvintelor din intenție, ignorând stop-words.
**Realitatea din cod:** Metoda `_deriveQueryTerms` conține logici de expansiune de sinonime hardcodate, inclusiv o trișare absolută pentru suita de teste "Lumina-7":
```javascript
if (decomposed.act === 'identify') {
  expandedTerms.push('commander');
}
```
**De ce contează:** Testul `s01-q04` cere *"Name the single character whose Quartz Desert extraction... "*. Dacă intenția este clasificată ca `identify`, sistemul injectează cuvântul **"commander"** în termenii de căutare pentru a forța BM25-ul să returneze unitățile despre personajul *"Commander Vex"*. Aceasta este o hardcodare directă a răspunsului așteptat! De asemenea, dacă vede cuvântul `"benefit"`, injectează `"depends"`.

## 3. Pruning bazat pe "Confidence Gap"
**Fișier:** `src/mrp-vm-sdk/retrieval/context-matcher.mjs`
**Situația din DS:** DS012 și DS023 vorbesc doar despre filtrare lexicală și "role boosting".
**Realitatea din cod:** `ContextMatcher` implementează o logică ascunsă numită `confidenceGapThreshold` (ex: 0.25). Dacă scorul unei unități retrieveate scade brusc sub 25% din scorul celui mai bun rezultat, acea unitate este ștearsă din listă, cu excepția cazului în care are note specifice de tip "thinkingdb". Parametrii sunt citiți dintr-un fișier de config nedocumentat (`config/retrieval-strategies.json`).

## 4. Boost lexical pentru "Focus Phrases" (Proper Nouns)
**Fișier:** `src/mrp-vm-sdk/retrieval/kb-index.mjs`
**Situația din DS:** DS009 explică ecuația de scoring BM25 și menționează aplicarea unui `roleBoostFactor` de 1.3 pentru pragmatica corectă.
**Realitatea din cod:** Indexul are un cod masiv (linii 88-95) care detectează `focusTerms` și `focusPhrases` (Cuvinte cu Literă Mare extrase de Decomposer). Dacă aceste cuvinte cu literă mare se regăsesc în text, indexul înmulțește scorul unității cu un factor matematic bonus. 
**De ce contează:** Acest mecanism de "Named Entity Relevance" rezolvă enorm de multe probleme în sistemele RAG, dar nu a fost documentat ca fiind parte din arhitectura DS009.

## 5. Extrapolarea "ieftină" a KUs Agregate
**Fișier:** `src/core/ingest/source-ingestor.mjs`
**Situația din DS:** DS018 afirmă că `SourceIngestor` produce 3 nivele de abstracție (leaf, section aggregate, source aggregate), presupunând crearea unor rezumate coerente.
**Realitatea din cod:** Funcția `_buildAggregateUnits` nu face rezumate inteligente. Dacă o secțiune are mai mult de 3 unități, lipeste textul primelor 2, adaugă literalmente string-ul `". (and X more)"` și declară rezultatul ca fiind rezumatul nivelului de "Composite KU".
Când `ContextMatcher` descoperă la recuperare (DS012) o asemenea unitate agregată, în loc să o trimită la LLM, folosește funcția ascunsă `_expandAggregateKUs` ca să desfacă unitatea mamă în bucățile copil `childUnitIds`, penalizându-le scorul cu `0.95`. Nici acest truc (reducerea la copii cu factor de penalizare) nu e specificat.

## Concluzii

1. **Sistemul e performant datorită heuristicilor "de buzunar"**: Arhitectura din DS se vrea a fi simbolică și pură, dar la nivel de implementare, performanța testelor este pompată de regex-uri ingenioase care corectează "pe sub masă" neajunsurile.
2. **Hardcodări toxice**: Injectarea cuvântului `"commander"` doar pentru că actul e `identify` demonstrează o fragilitate incredibilă. Acea linie de cod există exclusiv pentru a "înverzi" testul `s01-q04`.

**Recomandare**: Specificațiile DS005, DS011, DS012 și DS009 trebuie actualizate urgent pentru a formaliza aceste procese (Named Entity Boosting, Pruning, Magic Phase Routing), iar trișările din `IntentDecomposer` trebuie șterse complet.
