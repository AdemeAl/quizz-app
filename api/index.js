import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUESTIONS_FILE_PATH = path.resolve(
  __dirname,
  "src/questions_data/questions.json",
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// Initialiser l'API Google
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Connexion MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((err) => console.log(err));

// Fonctions utilitaires
const cleanAIResponse = (text) => {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
};

const saveQuestionsFromAI = (rawText) => {
  const cleaned = cleanAIResponse(rawText || "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Le format de questions est invalide.");
  }
  fs.writeFileSync(
    QUESTIONS_FILE_PATH,
    JSON.stringify(parsed, null, 2),
    "utf-8",
  );
};

// Routes Auth
app.post("/signup", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Champs manquants" });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: "Email ou pseudo déjà utilisé" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.json({ message: "Compte créé avec succès !" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if ((!email && !username) || !password) {
      return res.status(400).json({ message: "Identifiants incomplets" });
    }

    const user = await User.findOne(email ? { email } : { username });
    if (!user) {
      return res.status(400).json({ message: "Utilisateur introuvable" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mot de passe incorrect" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });
    res.json({
      message: "Connexion réussie",
      token,
      user: { id: user._id, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.get("/profile", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Non autorisé" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    res.json(user);
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
});

// Routes Quiz IA
app.post("/api/quiz/theme", async (req, res) => {
  try {
    const theme = String(req.body?.theme || "").trim();
    const langue = String(req.body?.langue || "").trim() || "français";

    if (!theme) {
      return res.status(400).json({ error: "Le thème est obligatoire." });
    }

    console.log(`Génération thème : ${theme} (${langue})`);

    const prompt = `
      Génère 10 questions de quiz sur le thème : ${theme}.
      Niveau : BAC. Langue : ${langue}.

      Respecte STRICTEMENT ce format JSON (un tableau d'objets) :
      [
        {
          "question": "string",
          "answers": { "a": "string", "b": "string", "c": "string" },
          "correctAnswer": "a | b | c",
          "explanation": "string"
        }
      ]
      Contraintes : Une seule bonne réponse, réponses courtes, explications pédagogiques.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    saveQuestionsFromAI(response.text);
    console.log("questions.json généré ✅");
    res.json({ url: "/quiz.html" });
  } catch (err) {
    console.error("Erreur Thème:", err);
    res.status(500).json({ error: "Échec de génération par thème" });
  }
});

app.post("/api/quiz/pdf", upload.single("monPdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier téléchargé." });
    }

    const langue = req.body.langue || "français";

    const contents = [
      { text: "Resume ce document de manière détaillée" },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: req.file.buffer.toString("base64"),
        },
      },
    ];

    const summaryResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
    });

    const summary = summaryResponse.text;
    console.log("Questions à partir du PDF générées ✅");

    const quizPrompt = `
      Génère 10 questions de quiz basées sur ce document :

      ${summary}

      Respecte STRICTEMENT ce format JSON.
      Ne mets AUCUN texte en dehors du JSON.

      Format exact :

      [
        {
          "question": "string",
          "answers": {
            "a": "string",
            "b": "string",
            "c": "string"
          },
          "correctAnswer": "a | b | c",
          "explanation": "string"
        }
      ]

      Contraintes :
      - une seule bonne réponse
      - réponses courtes
      - pas de répétition
      - explication cohérente
      - Langue : ${langue}
    `;

    const quizResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: quizPrompt,
    });

    saveQuestionsFromAI(quizResponse.text);
    console.log("questions.json généré à partir du PDF ✅");
    res.json({
      message: "Quiz généré depuis le PDF",
      url: "/quiz.html",
    });
  } catch (error) {
    console.error("DÉTAILS DE L'ERREUR :");
    console.error("Message:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/quiz/analyse", async (req, res) => {
  try {
    const score = Number(req.body?.score || 0);
    const total = Number(req.body?.total || 0);
    const theme = String(req.body?.theme || "Général");
    const errors = Array.isArray(req.body?.errors) ? req.body.errors : [];

    if (errors.length === 0) {
      return res.json({
        analysis:
          "Parfait ! Tu as fait un sans-faute. Tu maîtrises parfaitement ce sujet.",
      });
    }

    const prompt = `
      Agis comme un mentor expert en pédagogie. Analyse les résultats du quiz de l'utilisateur.

      DONNÉES DU QUIZ :
      - Thème : ${theme}
      - Score : ${score} / ${total}
      - Erreurs commises : ${JSON.stringify(errors)}

      TON OBJECTIF :
      Produis une analyse motivante et structurée en utilisant des émojis et un formatage clair.

      STRUCTURE DE TA RÉPONSE (Respecte ce plan) :
      1. **Bilan Global** : Une phrase d'encouragement personnalisée selon le score.
      2. **Analyse des erreurs** : Identifie les points de confusion (ex: "Tu sembles confondre X et Y").
      3. **Conseils Actionnables** : Donne 3 conseils concrets sous forme de liste à puces (utilisant 💡).
      4. **Le mot de la fin** : Une phrase courte pour booster la confiance.

      CONTRAINTES DE STYLE :
      - Utilise des sauts de ligne doubles entre les sections.
      - Utilise le gras (**) pour les mots-clés importants.
      - Pas d'introduction type "Voici l'analyse...", commence directement par le contenu.
      - Langue : Français.
    `;

    const analyse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    res.json({ analysis: analyse.text || "Analyse indisponible." });
  } catch (err) {
    console.error("Erreur Analyse IA:", err);
    res.status(500).json({ error: "L'IA n'a pas pu analyser les résultats." });
  }
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "landing-page")));
app.use(express.static(path.join(__dirname, "src")));

// Route par défaut pour quiz.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "quiz.html"));
});

export default app;
