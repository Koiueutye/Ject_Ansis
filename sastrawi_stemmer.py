import sys
import json
from Sastrawi.Stemmer.StemmerFactory import StemmerFactory

def run_stemmer():
    factory = StemmerFactory()
    stemmer = factory.create_stemmer()
    
    # Ensure dictionary includes common base words
    try:
        dict_obj = stemmer.delegatedStemmer.dictionary
        for word in ['berbagai', 'aplikasi', 'sederhana', 'segera']:
            dict_obj.add(word)
    except Exception:
        pass

    # Process line-by-line streaming input from Node.js
    for line in sys.stdin:
        line_str = line.strip()
        if not line_str:
            continue
        try:
            tokens = json.loads(line_str)
            if not tokens:
                print(json.dumps([]))
            else:
                sentence = " ".join(tokens)
                stemmed_sentence = stemmer.stem(sentence)
                print(json.dumps(stemmed_sentence.split()))
        except Exception:
            print(json.dumps([]))
        sys.stdout.flush()

if __name__ == '__main__':
    run_stemmer()
