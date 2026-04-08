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
const PROJECT_ROOT = path.resolve(__dirname, "../");
const QUESTIONS_FILE_PATH = path.resolve(
  PROJECT_ROOT,
  "src/questions_data/questions.json",
);

let generatedQuestionsCache = [];

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
  generatedQuestionsCache = parsed;
  return parsed;
};

// Routes Auth
app.post("/api/signup", async (req, res) => {
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

app.post("/api/login", async (req, res) => {
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

app.get("/api/profile", async (req, res) => {
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

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          "Clé GEMINI_API_KEY manquante. Configurez la variable d'environnement sur Vercel (Settings > Environment Variables).",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const textResult =
      response?.text ||
      response?.output?.[0]?.content?.[0]?.text ||
      response?.output?.[0]?.text ||
      "";

    if (!textResult) {
      console.error("Aucun texte retourné par l'IA", response);
      return res.status(502).json({
        error:
          "L'IA n'a pas renvoyé de texte de réponse. Vérifiez la connexion à l'API Gemini.",
      });
    }

    let parsed;
    try {
      parsed = saveQuestionsFromAI(textResult);
    } catch (parseErr) {
      console.error("Erreur parsing questions IA:", parseErr);
      return res
        .status(500)
        .json({ error: "Impossible de parser le JSON généré par l'IA." });
    }

    console.log("questions générées ✅");
    res.json({ questions: parsed });
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

    const textResult =
      quizResponse?.text ||
      quizResponse?.output?.[0]?.content?.[0]?.text ||
      quizResponse?.output?.[0]?.text ||
      "";

    if (!textResult) {
      console.error("Aucun texte retourné par l'IA (PDF)", quizResponse);
      return res.status(502).json({
        error:
          "L'IA n'a pas renvoyé de texte de réponse (PDF). Vérifiez la configuration Gemini.",
      });
    }

    let parsed;
    try {
      parsed = saveQuestionsFromAI(textResult);
    } catch (parseErr) {
      console.error("Erreur parsing PDF IA:", parseErr);
      return res.status(500).json({
        error: "Impossible de parser le JSON généré à partir du PDF.",
      });
    }

    console.log("questions générées à partir du PDF ✅");
    res.json({ message: "Quiz généré depuis le PDF", questions: parsed });
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

app.get("/api/quiz/questions", async (req, res) => {
  try {
    if (generatedQuestionsCache.length > 0) {
      return res.json({ questions: generatedQuestionsCache });
    }

    const fileData = await fs.promises.readFile(QUESTIONS_FILE_PATH, "utf-8");
    const questions = JSON.parse(fileData);
    return res.json({ questions });
  } catch (err) {
    console.error("Impossible de charger questions locales:", err);
    return res
      .status(500)
      .json({ error: "Impossible de charger les questions" });
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

// Route pour config Supabase (clé publique)
app.get("/api/config", (req, res) => {
  console.log("📋 Variables env disponibles:");
  console.log(
    "  - SUPABASE_URL:",
    process.env.SUPABASE_URL ? "✅ défini" : "❌ undefined",
  );
  console.log(
    "  - SUPABASE_KEY:",
    process.env.SUPABASE_KEY ? "✅ défini" : "❌ undefined",
  );

  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
  });
});

// Servir les fichiers statiques depuis public/ et landing-page/
app.use(express.static(path.join(PROJECT_ROOT, "public")));
app.use(express.static(path.join(PROJECT_ROOT, "landing-page")));

// Routes pour les pages HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "index.html"));
});
app.get("/quiz.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "quiz.html"));
});
app.get("/landing-page/index.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "landing-page", "index.html"));
});
app.get("/leaderboard.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "landing-page", "leaderboard.html"));
});
app.get("/login.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "landing-page", "login.html"));
});
app.get("/effects.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "effects.html"));
});

export default app;
