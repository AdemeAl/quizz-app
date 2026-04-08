import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import "dotenv/config";

// --- CONFIGURATION SUPABASE ---
let SUPABASE_URL = "";
let SUPABASE_KEY = "";
let _supabase = null;

// Charger la config Supabase depuis le serveur
async function loadSupabaseConfig() {
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      const config = await response.json();
      SUPABASE_URL = config.supabaseUrl;
      SUPABASE_KEY = config.supabaseKey;
      _supabase =
        SUPABASE_URL && SUPABASE_KEY
          ? createClient(SUPABASE_URL, SUPABASE_KEY)
          : null;
    } else {
      console.warn("Config Supabase non disponible");
    }
  } catch (err) {
    console.warn("Erreur chargement config Supabase:", err);
  }
}

// --- VARIABLES D'ÉTAT ---
let data = [];
let quizErrors = []; // Stocke les erreurs pour l'IA
let currentQuestion = 0;
let Incscore = 0;
let Corscore = 0;
let hasAnswered = false;
let time = 60;
let timerInterval;
let isQuizEnded = false;

// --- SÉLECTEURS DOM ---
const questionTitle = document.getElementById("question");
const answersButtons = document.getElementById("answer-buttons");
const correctScore = document.getElementById("correct-score");
const incorrectScore = document.getElementById("incorrect-score");
const questionLvl = document.getElementById("questions-lvl");
const nextQuestionBtn = document.getElementsByClassName("next-button");
const quizContainer = document.getElementsByClassName("quiz");
const progressBar = document.getElementsByClassName("bar");
const scoreSection = document.getElementById("score-section");
const scoreSpan = document.getElementById("score-span");
const quizRemark = document.getElementById("quiz-remark");
const demo = document.getElementById("demo");

// Boutons d'action
const quitBtn = document.getElementById("quit-btn");
const quitModal = document.getElementById("quit-modal");
const cancelBtn = document.getElementById("cancel-btn");
const confirmQuitBtn = document.getElementById("confirm-quit-btn");
const shareBtn = document.getElementById("share-btn");
const analyseBtn = document.getElementById("analyse-btn");

// --- INITIALISATION ---

async function initializeQuiz() {
  await loadSupabaseConfig(); // Charger config Supabase d'abord

  const urlParams = new URLSearchParams(window.location.search);
  const sharedId = urlParams.get("sharedId");

  if (sharedId && _supabase) {
    console.log("Chargement du quiz partagé...");
    const { data: sharedData, error } = await _supabase
      .from("quizzes")
      .select("content")
      .eq("id", sharedId)
      .single();

    if (error || !sharedData?.content) {
      console.error(
        "Erreur Supabase:",
        error?.message || "Quiz partagé introuvable",
      );
      await loadLocalData();
    } else {
      data = sharedData.content;
    }
  } else {
    await loadLocalData();
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Aucune question valide trouvée.");
  }

  startTimer();
  quiz();
}

async function loadLocalData() {
  // Priorité aux questions stockées en session lors de la génération,
  // puis à l'API (en mode déploiement Vercel), puis fallback local.
  const storedQuiz = sessionStorage.getItem("generatedQuiz");
  if (storedQuiz) {
    try {
      const parsed = JSON.parse(storedQuiz);
      if (Array.isArray(parsed) && parsed.length > 0) {
        data = parsed;
        return;
      }
    } catch (err) {
      console.warn("Données de quiz en session invalides :", err);
    }
    sessionStorage.removeItem("generatedQuiz");
  }

  try {
    const response = await fetch("/api/quiz/questions");
    if (response.ok) {
      const result = await response.json();
      if (Array.isArray(result.questions) && result.questions.length > 0) {
        data = result.questions;
        return;
      }
    }
  } catch (err) {
    console.warn("Échec chargement questions via API, fallback local :", err);
  }

  const response = await fetch("./questions_data/questions.json");
  if (!response.ok) {
    throw new Error("Impossible de charger les questions locales.");
  }
  data = await response.json();
}

// --- LOGIQUE DU QUIZ ---

function quiz() {
  nextQuestionBtn[0].classList.add("disabled");
  nextQuestionBtn[0].disabled = true;

  if (currentQuestion >= data.length) {
    endQuiz();
  } else {
    showQuestion();
    showAnswers();
  }
}

function showQuestion() {
  questionTitle.innerHTML = data[currentQuestion].question;
}

function showAnswers() {
  let answers = data[currentQuestion].answers;
  questionLvl.innerText = `${currentQuestion + 1}/${data.length}`;

  answersButtons.innerHTML = Object.keys(answers)

    .map(
      (key, index) => `
        <button data-key="${key}" id="${key}" class="buttons"><span class="key-hint">${index + 1}</span> ${answers[key]}</button> 
    `,
    )
    .join("");

  // Préparation de l'emplacement de l'explication (caché par défaut)
  const correctId = data[currentQuestion].correctAnswer;
  const correctBtn = document.getElementById(correctId);
  if (correctBtn) {
    correctBtn.innerHTML += `
            <div class="explanation">
                <p id="explication"></p>
            </div>`;
  }
}

function checkAnswer(answerKey, clickedButton) {
  let correctAnswer = data[currentQuestion].correctAnswer;

  if (answerKey === correctAnswer) {
    clickedButton.classList.add("correct-answer");
    Corscore++;
    correctScore.innerHTML = Corscore;
  } else {
    shakeWindow();
    playThudSound();
    clickedButton.classList.add("incorrect-answer");
    Incscore++;
    incorrectScore.innerHTML = Incscore;

    // Capture de l'erreur pour l'analyse IA
    quizErrors.push({
      question: data[currentQuestion].question,
      reponseDonnee: data[currentQuestion].answers[answerKey],
      bonneReponse: data[currentQuestion].answers[correctAnswer],
      explication: data[currentQuestion].explanation,
    });
  }

  const explicationContainer = document.querySelector(".explanation");
  const explicationText = document.getElementById("explication");
  if (explicationContainer) explicationContainer.classList.add("visible");
  if (explicationText)
    explicationText.innerText = data[currentQuestion].explanation;
}

// --- ANALYSE & CLOUD ---

async function analyseQuiz() {
  const analysisText = document.getElementById("analysis-text");
  if (analysisText) analysisText.innerText = "L'IA analyse vos résultats...";

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const currentTheme = urlParams.get("theme") || "Général";

    const response = await fetch("/api/quiz/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: Corscore,
        total: data.length,
        theme: currentTheme,
        errors: quizErrors,
      }),
    });

    if (!response.ok) {
      throw new Error("Erreur de réponse API analyse");
    }
    const result = await response.json();
    // Transformation simple du Markdown en HTML

    if (analysisText) {
      let formattedAnalysis = result.analysis
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Gère le gras
        .replace(/\n/g, "<br>") // Gère les retours à la ligne
        .replace(/💡/g, "<br>💡"); // S'assure que chaque conseil est sur une nouvelle ligne
      analysisText.innerHTML = formattedAnalysis;
    }
  } catch (error) {
    console.error("Erreur Analyse:", error);
    if (analysisText)
      analysisText.innerText = "Erreur lors de la récupération de l'analyse.";
  }
}

async function createShareLink() {
  if (!_supabase) {
    await loadSupabaseConfig();
  }
  if (!_supabase) {
    alert("La fonctionnalité de partage n'est pas configurée.");
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const currentTheme = urlParams.get("theme") || "Général";

  const { data: insertedData, error } = await _supabase
    .from("quizzes")
    .insert([{ title: currentTheme, content: data }])
    .select();

  if (!error && insertedData?.[0]?.id) {
    const shareableLink = `${window.location.origin}${window.location.pathname}?sharedId=${insertedData[0].id}`;
    navigator.clipboard.writeText(shareableLink).then(() => {
      alert("Lien de partage copié !");
    });
  } else {
    console.error("Erreur création lien de partage:", error?.message);
    alert("Impossible de créer le lien de partage.");
  }
}

async function saveScoreToCloud(points) {
  const sessionUser = JSON.parse(localStorage.getItem("sessionUser"));
  const name = sessionUser
    ? sessionUser.username || sessionUser.pseudo
    : "Joueur Anonyme";
  const urlParams = new URLSearchParams(window.location.search);
  const currentTheme = urlParams.get("theme") || "Général";

  if (!_supabase) {
    await loadSupabaseConfig();
  }
  if (!_supabase) {
    console.warn(
      "La sauvegarde du score est désactivée : Supabase non configuré.",
    );
    return;
  }

  const { error } = await _supabase
    .from("leaderboard")
    .insert([{ username: name, score: points, theme: currentTheme }]);
  if (error) {
    console.error("Erreur sauvegarde score:", error.message);
  }
}

// --- UTILITAIRES & EVENTS ---

function startTimer() {
  timerInterval = setInterval(() => {
    time--;
    demo.innerText = `0:${time}`;
    if (time <= 20) demo.style.color = "red";
    if (time <= 0) {
      clearInterval(timerInterval);
      endQuiz();
    }
  }, 1000);
}

function endQuiz() {
  if (isQuizEnded) return;
  isQuizEnded = true;
  window.speechSynthesis.cancel();
  clearInterval(timerInterval);
  quizContainer[0].classList.add("invisible");
  scoreSection.classList.add("visible");
  saveScoreToCloud(Corscore);

  scoreSpan.innerText = `${Corscore}/${data.length}`;
  quizRemark.innerText =
    Corscore >= data.length ? "Bravo ! Quiz terminé" : "Dommage ! Quiz terminé";
  if (Corscore >= data.length) {
    document.body.classList.add("apply-win-shake");
    setTimeout(() => document.body.classList.remove("apply-win-shake"), 400);
  }

  setCookie("score", (Corscore / data.length) * 100, 30);
}

function nextQuestion() {
  window.speechSynthesis.cancel();
  hasAnswered = false;
  currentQuestion++;
  quiz();
  progressBar[0].style.width = (currentQuestion / data.length) * 100 + "%";
}

// Event Listeners
answersButtons.addEventListener("click", (event) => {
  const clickedButton = event.target.closest(".buttons");
  if (clickedButton && !hasAnswered && time > 0) {
    hasAnswered = true;
    nextQuestionBtn[0].classList.remove("disabled");
    nextQuestionBtn[0].disabled = false;
    checkAnswer(clickedButton.dataset.key, clickedButton);
  }
});

if (nextQuestionBtn[0])
  nextQuestionBtn[0].addEventListener("click", nextQuestion);
if (shareBtn) shareBtn.addEventListener("click", createShareLink);
if (analyseBtn) analyseBtn.addEventListener("click", analyseQuiz);

// Cookies & Quit
function setCookie(cname, cvalue, exdays) {
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  document.cookie = `${cname}=${cvalue};expires=${d.toUTCString()};path=/`;
}

if (quitBtn && quitModal) {
  quitBtn.addEventListener("click", () => (quitModal.style.display = "flex"));
}
if (cancelBtn && quitModal) {
  cancelBtn.addEventListener("click", () => (quitModal.style.display = "none"));
}
if (confirmQuitBtn) {
  confirmQuitBtn.addEventListener(
    "click",
    () => (window.location.href = "../landing-page/index.html"),
  );
}

// --- EFFETS SONORES ET VISUELS (Gardés tels quels) ---
function shakeWindow() {
  document.body.classList.add("shake-effect");
  setTimeout(() => document.body.classList.remove("shake-effect"), 500);
}

function playThudSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(150, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.2);
}

// Fonction Text to speech

function textToSpeech() {
  window.speechSynthesis.cancel();
  let text = data[currentQuestion].question;
  let speech = new SpeechSynthesisUtterance();
  speech.text = text;
  speech.volume = 1;
  speech.rate = 1;
  speech.pitch = 1;
  window.speechSynthesis.speak(speech);
}
const speechBtn = document.getElementById("speech-btn");
if (speechBtn) {
  speechBtn.addEventListener("click", textToSpeech);
}

// --- GESTION DU CLAVIER (TOUCHES 1, 2, 3 et ENTRÉE) ---

window.addEventListener("keydown", (event) => {
  // 1. On vérifie si le quiz est en cours et si l'utilisateur n'a pas encore répondu
  if (time <= 0 || currentQuestion >= data.length) return;

  const key = event.key;

  // Mapping des touches 1, 2, 3 vers les IDs de tes boutons
  const buttonsMapping = {
    1: document.getElementById("a"),
    2: document.getElementById("b"),
    3: document.getElementById("c"),
  };

  // SI l'utilisateur appuie sur 1, 2 ou 3 ET qu'il n'a pas encore répondu
  if (buttonsMapping[key] && !hasAnswered) {
    const targetBtn = buttonsMapping[key];
    const answerKey = targetBtn.dataset.key; // Récupère "a", "b" ou "c"

    // On simule la validation
    hasAnswered = true;
    nextQuestionBtn[0].classList.remove("disabled");
    nextQuestionBtn[0].disabled = false;

    // On appelle ta fonction de vérification existante
    checkAnswer(answerKey, targetBtn);
  }

  // SI l'utilisateur appuie sur Entrée ET qu'il a déjà répondu -> Question suivante
  if (key === "Enter" && hasAnswered) {
    nextQuestion();
  }
  if (key === " ") {
    textToSpeech();
  }
});
// Lancement
initializeQuiz().catch((error) => {
  console.error("Erreur d'initialisation du quiz:", error);
  questionTitle.innerText = "Erreur de chargement du quiz.";
  answersButtons.innerHTML = "";
});
