import streamlit as st
import pandas as pd
import numpy as np
import re
import matplotlib.pyplot as plt
import seaborn as sns
from wordcloud import WordCloud

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.naive_bayes import MultinomialNB
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

from Sastrawi.Stemmer.StemmerFactory import StemmerFactory
from Sastrawi.StopWordRemover.StopWordRemoverFactory import StopWordRemoverFactory

# Konfigurasi Halaman
st.set_page_config(page_title="Sentimen Analisis - Tawon", page_icon="🐝", layout="wide")

@st.cache_resource
def load_nlp_tools():
    # Load Sastrawi Stemmer & Stopwords
    stemmer = StemmerFactory().create_stemmer()
    stopwords = StopWordRemoverFactory().get_stop_words()
    # Hapus kata negasi dari stopwords agar makna sentimen tidak hilang
    negations = ['tidak', 'belum', 'bukan', 'jangan']
    stopwords = [w for w in stopwords if w not in negations]
    
    # Tambahkan custom stopword untuk konteks review
    custom_stopwords = ['nya', 'yg', 'di', 'ke', 'dari', 'ini', 'itu', 'dan', 'atau', 'untuk', 'dengan']
    stopwords.extend(custom_stopwords)
    return stemmer, set(stopwords)

def preprocess_text(text, stemmer, stopwords):
    # 1. Cleaning & Case Folding
    text = str(text).lower()
    text = re.sub(r'https?://\S+|www\.\S+', '', text) # Hapus URL
    text = re.sub(r'[^a-z\s]', ' ', text) # Hapus angka dan simbol
    
    # 2. Tokenization
    tokens = text.split()
    
    # 3. Stopword Removal
    tokens = [w for w in tokens if w not in stopwords and len(w) > 1]
    
    # 4. Stemming (Sastrawi)
    tokens = [stemmer.stem(w) for w in tokens]
    
    return ' '.join(tokens)

# Header Aplikasi
st.title("Website Analisis Sentimen")

# Upload Data
st.sidebar.header("📁 Upload Dataset")
uploaded_file = st.sidebar.file_uploader("Pilih file CSV ulasan", type=["csv"])

if uploaded_file is not None:
    df = pd.read_csv(uploaded_file)
    st.write("### 📊 Preview Data Original", df.head())
    
    # Auto-detect kolom teks dan rating
    text_col = None
    rating_col = None
    sentiment_col = None
    
    for col in df.columns:
        col_lower = col.lower()
        if 'text' in col_lower or 'review' in col_lower or 'ulasan' in col_lower or 'content' in col_lower:
            text_col = col
        if 'rating' in col_lower or 'score' in col_lower or 'bintang' in col_lower:
            rating_col = col
        if 'sentiment' in col_lower or 'label' in col_lower:
            sentiment_col = col
            
    # Jika auto-detect gagal, beri opsi manual
    col1, col2 = st.columns(2)
    with col1:
        text_col = st.selectbox("Pilih kolom teks/ulasan:", df.columns, index=df.columns.get_loc(text_col) if text_col else 0)
    with col2:
        if sentiment_col:
            label_mode = st.radio("Mode Pelabelan", ["Gunakan Kolom Sentimen yang Ada"])
            label_col = sentiment_col
        elif rating_col:
            label_mode = st.radio("Mode Pelabelan", ["Otomatis dari Rating (1-3: Negatif, 4-5: Positif)"])
            label_col = rating_col
        else:
            st.error("Kolom rating atau sentimen tidak ditemukan!")
            st.stop()

    if st.sidebar.button("🚀 Jalankan NLP Pipeline & Modeling"):
        with st.spinner("Menjalankan Preprocessing dengan Sastrawi... (Ini mungkin memakan waktu untuk dataset besar)"):
            stemmer, stopwords = load_nlp_tools()
            
            # Preprocessing
            df['clean_text'] = df[text_col].apply(lambda x: preprocess_text(x, stemmer, stopwords))
            
            # Labeling
            if sentiment_col:
                df['Sentiment'] = df[sentiment_col]
            else:
                df['Sentiment'] = df[rating_col].apply(lambda x: 'Positif' if pd.to_numeric(x, errors='coerce') >= 4 else 'Negatif')
            
            # Hapus data kosong setelah cleaning
            df = df[df['clean_text'].str.strip() != '']
            
        st.success("Preprocessing Selesai!")
        
        st.write("### 🧹 Data Setelah Preprocessing")
        st.dataframe(df[[text_col, 'clean_text', 'Sentiment']].head(10))
        
        # Modeling Phase
        with st.spinner("Mengekstraksi Fitur TF-IDF & Melatih Model..."):
            vectorizer = TfidfVectorizer(max_features=5000)
            X = vectorizer.fit_transform(df['clean_text'])
            y = df['Sentiment']
            
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            models = {
                "SVM (Linear)": SVC(kernel='linear', probability=True),
                "KNN (k=5)": KNeighborsClassifier(n_neighbors=5),
                "Naive Bayes (Multinomial)": MultinomialNB()
            }
            
            results = {}
            for name, model in models.items():
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                acc = accuracy_score(y_test, y_pred)
                results[name] = {
                    "model": model,
                    "accuracy": acc,
                    "pred": y_pred
                }
                
        st.write("---")
        st.write("### 🧠 Hasil Evaluasi Model Machine Learning")
        
        # Tampilkan Metrik Akurasi
        metrics_cols = st.columns(3)
        for i, (name, res) in enumerate(results.items()):
            metrics_cols[i].metric(label=f"Akurasi {name}", value=f"{res['accuracy']*100:.1f}%")
            
        # Pilih Model untuk Dilihat Detailnya
        selected_model_name = st.selectbox("Pilih Model untuk melihat Classification Report & Confusion Matrix:", list(models.keys()))
        selected_res = results[selected_model_name]
        
        report_col, cm_col = st.columns(2)
        
        with report_col:
            st.write("#### Classification Report")
            report_dict = classification_report(y_test, selected_res['pred'], output_dict=True)
            report_df = pd.DataFrame(report_dict).transpose()
            st.dataframe(report_df.style.format("{:.3f}"))
            
        with cm_col:
            st.write("#### Confusion Matrix")
            cm = confusion_matrix(y_test, selected_res['pred'], labels=["Negatif", "Positif"])
            fig, ax = plt.subplots(figsize=(5, 4))
            sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', ax=ax, 
                        xticklabels=["Negatif", "Positif"], yticklabels=["Negatif", "Positif"])
            ax.set_xlabel("Prediksi")
            ax.set_ylabel("Aktual")
            st.pyplot(fig)
            
        # Wordcloud Section
        st.write("---")
        st.write("### ☁️ WordCloud Sentimen")
        wc_col1, wc_col2 = st.columns(2)
        
        def generate_wordcloud(text_series, title, colormap):
            text = " ".join(text_series)
            if text.strip():
                wc = WordCloud(width=600, height=400, background_color='white', colormap=colormap).generate(text)
                fig, ax = plt.subplots()
                ax.imshow(wc, interpolation='bilinear')
                ax.axis('off')
                ax.set_title(title, fontsize=16, fontweight='bold')
                return fig
            return None

        with wc_col1:
            fig_neg = generate_wordcloud(df[df['Sentiment'] == 'Negatif']['clean_text'], "Sentimen Negatif", 'Reds')
            if fig_neg: st.pyplot(fig_neg)
            else: st.info("Tidak ada data negatif yang cukup untuk Wordcloud.")
            
        with wc_col2:
            fig_pos = generate_wordcloud(df[df['Sentiment'] == 'Positif']['clean_text'], "Sentimen Positif", 'Greens')
            if fig_pos: st.pyplot(fig_pos)
            else: st.info("Tidak ada data positif yang cukup untuk Wordcloud.")

        # Save models in session state for manual prediction
        st.session_state['models'] = models
        st.session_state['vectorizer'] = vectorizer

# Live Prediction
if 'models' in st.session_state:
    st.write("---")
    st.write("### 🔮 Uji Prediksi Kalimat (Live)")
    test_input = st.text_input("Masukkan kalimat untuk diuji sentimennya:")
    
    if st.button("Prediksi Sentimen"):
        if test_input.strip():
            stemmer, stopwords = load_nlp_tools()
            clean_input = preprocess_text(test_input, stemmer, stopwords)
            vec_input = st.session_state['vectorizer'].transform([clean_input])
            
            pred_cols = st.columns(3)
            for i, (name, model) in enumerate(st.session_state['models'].items()):
                pred = model.predict(vec_input)[0]
                color = "green" if pred == "Positif" else "red"
                emoji = "👍" if pred == "Positif" else "👎"
                
                with pred_cols[i]:
                    st.markdown(f"**{name}**")
                    st.markdown(f"<h3 style='color: {color};'>{emoji} {pred}</h3>", unsafe_allow_html=True)
        else:
            st.warning("Masukkan kalimat terlebih dahulu.")
else:
    st.info("👈 Upload dataset dan jalankan modeling untuk mengaktifkan fitur Uji Prediksi Sentimen.")
