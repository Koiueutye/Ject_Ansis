const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const targetUseEffect = `  useEffect(() => {
    localStorage.setItem('dataStatus', dataStatus);
  }, [dataStatus]);
  useEffect(() => {
    if (preprocessedData) localStorage.setItem('preprocessedData', JSON.stringify(preprocessedData));
    else localStorage.removeItem('preprocessedData');
  }, [preprocessedData]);
  useEffect(() => {
    localStorage.setItem('reviewsData', JSON.stringify(reviewsData));
  }, [reviewsData]);`;

const replacementUseEffect = `  useEffect(() => {
    try { localStorage.setItem('dataStatus', dataStatus); } catch (e) {}
  }, [dataStatus]);
  useEffect(() => {
    try {
      if (preprocessedData) localStorage.setItem('preprocessedData', JSON.stringify(preprocessedData));
      else localStorage.removeItem('preprocessedData');
    } catch (e) { console.error('LocalStorage quota exceeded for preprocessedData'); }
  }, [preprocessedData]);
  useEffect(() => {
    try {
      localStorage.setItem('reviewsData', JSON.stringify(reviewsData));
    } catch (e) { console.error('LocalStorage quota exceeded for reviewsData'); }
  }, [reviewsData]);`;

content = content.replace(targetUseEffect, replacementUseEffect);

// Wait, the previous format might have different spaces or newlines. 
// Let's just use string replace carefully for each one individually:

content = content.replace(
  "localStorage.setItem('dataStatus', dataStatus);",
  "try { localStorage.setItem('dataStatus', dataStatus); } catch (e) {}"
);
content = content.replace(
  "if (preprocessedData) localStorage.setItem('preprocessedData', JSON.stringify(preprocessedData));",
  "try { if (preprocessedData) localStorage.setItem('preprocessedData', JSON.stringify(preprocessedData)); } catch (e) {}"
);
content = content.replace(
  "else localStorage.removeItem('preprocessedData');",
  "try { if (!preprocessedData) localStorage.removeItem('preprocessedData'); } catch (e) {}"
);
content = content.replace(
  "localStorage.setItem('reviewsData', JSON.stringify(reviewsData));",
  "try { localStorage.setItem('reviewsData', JSON.stringify(reviewsData)); } catch (e) { console.error('Storage full'); }"
);
content = content.replace(
  "localStorage.setItem('isLoggedIn', isLoggedIn);",
  "try { localStorage.setItem('isLoggedIn', isLoggedIn); } catch(e){}"
);
content = content.replace(
  "if (user) localStorage.setItem('user', JSON.stringify(user));",
  "try { if (user) localStorage.setItem('user', JSON.stringify(user)); } catch(e){}"
);
content = content.replace(
  "else localStorage.removeItem('user');",
  "try { if (!user) localStorage.removeItem('user'); } catch(e){}"
);


fs.writeFileSync('src/App.tsx', content, 'utf8');
