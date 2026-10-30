const express = require("express");
const cors = require("cors");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Word Panic server is running!");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = new Map();

const TOTAL_ROUNDS = 15;
const ROUNDS_PER_LEVEL = 5;
const ROUND_TIME_MS = 30000;
const RESULTS_TIME_MS = 4000;
const STARTING_HINTS = 5;

const WORD_BANKS = {
  Easy: [
    "apple", "chair", "cloud", "bread", "plant",
    "smile", "water", "music", "light", "table",
    "house", "tiger", "grape", "beach", "clock",
    "dance", "heart", "shirt", "candy", "piano",
    "lemon", "grass", "stone", "spoon", "train",
    "mouse", "dream", "paint", "horse", "crown",
    "flame", "glass", "pearl", "truck", "snake",
    "brush", "sugar", "smoke", "ring", "fruit"
  ],

  Medium: [
    "planet", "rocket", "bridge", "jungle", "silver",
    "castle", "stream", "forest", "button", "orange",
    "school", "puzzle", "window", "camera", "travel",
    "bright", "friend", "flower", "monkey", "dragon",
    "winter", "basket", "circle", "market", "thunder",
    "diamond", "journey", "rainbow", "victory", "perfect",
    "library", "picture", "morning", "airport", "battery",
    "compass", "blanket", "captain", "traffic", "concert"
  ],

  Hard: [
    "labyrinth", "silhouette", "kaleidoscope", "constellation",
    "perseverance", "architecture", "encyclopedia", "magnificent",
    "camouflage", "mischievous", "extraordinary", "infrastructure",
    "precipitation", "circumference", "metamorphosis", "contradictory",
    "acknowledge", "catastrophe", "phenomenon", "equilibrium",
    "biodiversity", "jurisdiction", "unpredictable", "revolutionary",
    "consequence", "observation", "imagination", "independent",
    "complicated", "investigation", "determination", "intelligence",
    "environment", "civilization", "unbelievable", "communication",
    "responsibility", "demonstration", "transformation", "magnification"
  ]
};

function makeCode() {
  let code;

  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));

  return code;
}

function shuffleArray(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function getDifficulty(round) {
  if (round >= 1 && round <= 5) return "Easy";
  if (round >= 6 && round <= 10) return "Medium";
  return "Hard";
}

function createGameWordSet(room) {
  const previousMatchWords = new Set(room.recentGameWords || []);
  const selectedWords = [];

  for (const level of ["Easy", "Medium", "Hard"]) {
    const uniquePool = [...new Set(WORD_BANKS[level])];

    let available = uniquePool.filter(
      (word) => !previousMatchWords.has(word)
    );

    if (available.length < ROUNDS_PER_LEVEL) {
      available = uniquePool;
    }

    const picked = shuffleArray(available).slice(
      0,
      ROUNDS_PER_LEVEL
    );

    selectedWords.push(...picked);
  }

  room.recentGameWords = [...selectedWords];

  return selectedWords;
}

function scramble(word) {
  const original = word.toLowerCase();
  const letters = original.split("");

  for (let attempt = 0; attempt < 30; attempt++) {
    const shuffled = shuffleArray(letters);

    if (shuffled.join("") !== original) {
      return shuffled.join("").toUpperCase();
    }
  }

  const fallback = [...letters];
  fallback.push(fallback.shift());

  if (fallback.join("") === original) {
    fallback.reverse();
  }

  return fallback.join("").toUpperCase();
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,

    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      answered: player.answered,
      lastPoints: player.lastPoints,
      rematchReady: player.rematchReady,
      streak: player.streak,
      lastComboBonus: player.lastComboBonus,
      hints: player.hints,

      revealedWord:
        room.status === "playing"
          ? room.word
              .toUpperCase()
              .split("")
              .map((letter, index) =>
                player.revealedLetters.includes(index) ? letter : ""
              )
          : []
    })),

    status: room.status,
    round: room.round,
    totalRounds: room.totalRounds,
    difficulty: room.difficulty,
    scrambledWord: room.scrambledWord,
    revealedAnswer: room.revealedAnswer,
    roundEndsAt: room.roundEndsAt,
    resultsEndsAt: room.resultsEndsAt,
    remainingMs: room.remainingMs,

    // Used by clients to synchronize their countdown clocks.
    serverNow: Date.now(),

    message: room.message
  };
}

function updateRoom(room) {
  io.to(room.code).emit("roomUpdated", publicRoom(room));
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function finishGame(room, message = "All 15 rounds completed!") {
  clearRoomTimer(room);

  room.status = "finished";
  room.roundEndsAt = null;
  room.resultsEndsAt = null;
  room.remainingMs = null;
  room.revealedAnswer = room.word
    ? room.word.toUpperCase()
    : null;
  room.message = message;
  room.resumeStatus = null;

  updateRoom(room);

  console.log(`[${room.code}] Game finished.`);
}

function startRound(room) {
  if (!rooms.has(room.code)) return;

  if (room.round >= TOTAL_ROUNDS) {
    finishGame(room);
    return;
  }

  clearRoomTimer(room);

  room.round += 1;
  room.totalRounds = TOTAL_ROUNDS;
  room.difficulty = getDifficulty(room.round);
  room.word = room.gameWords[room.round - 1];

  if (!room.word) {
    finishGame(
      room,
      "The word set could not be loaded. Please start a rematch."
    );
    return;
  }

  room.scrambledWord = scramble(room.word);
  room.status = "playing";
  room.message = "";
  room.revealedAnswer = null;
  room.resultsEndsAt = null;
  room.remainingMs = null;
  room.resumeStatus = null;
  room.roundEndsAt = Date.now() + ROUND_TIME_MS;

  room.players.forEach((player) => {
    player.answered = false;
    player.lastPoints = 0;
    player.lastComboBonus = 0;
    player.revealedLetters = [];
  });

  const thisRound = room.round;

  console.log(
    `[${room.code}] Round ${thisRound}/${TOTAL_ROUNDS} started — ${room.difficulty}`
  );

  updateRoom(room);

  room.timer = setTimeout(() => {
    // Ignore an old timer if the room has moved to another round.
    if (
      !rooms.has(room.code) ||
      room.status !== "playing" ||
      room.round !== thisRound
    ) {
      return;
    }

    finishRound(room);
  }, ROUND_TIME_MS);
}

function finishRound(room) {
  if (!rooms.has(room.code) || room.status !== "playing") {
    return;
  }

  clearRoomTimer(room);

  const completedRound = room.round;

  room.status = "results";
  room.revealedAnswer = room.word.toUpperCase();
  room.roundEndsAt = null;
  room.resultsEndsAt = Date.now() + RESULTS_TIME_MS;
  room.remainingMs = null;
  room.message = `Round ${room.round} completed!`;

  console.log(
    `[${room.code}] Round ${completedRound} finished. Results timer: ${RESULTS_TIME_MS}ms`
  );

  updateRoom(room);

  room.timer = setTimeout(() => {
    if (
      !rooms.has(room.code) ||
      room.status !== "results" ||
      room.round !== completedRound
    ) {
      console.log(
        `[${room.code}] Next-round timer cancelled or state changed.`
      );
      return;
    }

    console.log(
      `[${room.code}] Results timer completed. Moving on from round ${completedRound}.`
    );

    if (room.round >= TOTAL_ROUNDS) {
      finishGame(room);
    } else {
      startRound(room);
    }
  }, RESULTS_TIME_MS);
}

function pauseForSoloChoice(room) {
  if (!["playing", "results"].includes(room.status)) return;

  clearRoomTimer(room);

  room.resumeStatus = room.status;

  room.remainingMs =
    room.status === "playing"
      ? Math.max(0, (room.roundEndsAt || Date.now()) - Date.now())
      : Math.max(0, (room.resultsEndsAt || Date.now()) - Date.now());

  room.status = "soloChoice";
  room.roundEndsAt = null;
  room.resultsEndsAt = null;
  room.message = "Only one player remains. Choose how to continue.";

  updateRoom(room);
}

function resumeSavedGame(room, solo = false) {
  if (!rooms.has(room.code)) return;

  const previousStatus = room.resumeStatus || "playing";
  const remaining = Math.max(250, room.remainingMs ?? ROUND_TIME_MS);

  clearRoomTimer(room);

  room.status = previousStatus;
  room.message = solo
    ? "Continuing solo. Complete the remaining rounds!"
    : "Player joined. Resuming the game.";

  room.roundEndsAt = null;
  room.resultsEndsAt = null;
  room.remainingMs = null;
  room.resumeStatus = null;

  if (previousStatus === "results") {
    room.resultsEndsAt = Date.now() + remaining;

    updateRoom(room);

    const savedRound = room.round;

    room.timer = setTimeout(() => {
      if (
        !rooms.has(room.code) ||
        room.status !== "results" ||
        room.round !== savedRound
      ) {
        return;
      }

      if (room.round >= TOTAL_ROUNDS) {
        finishGame(room);
      } else {
        startRound(room);
      }
    }, remaining);

    return;
  }

  room.status = "playing";
  room.roundEndsAt = Date.now() + remaining;

  updateRoom(room);

  const savedRound = room.round;

  room.timer = setTimeout(() => {
    if (
      !rooms.has(room.code) ||
      room.status !== "playing" ||
      room.round !== savedRound
    ) {
      return;
    }

    finishRound(room);
  }, remaining);
}

function resetForRematch(room) {
  if (!rooms.has(room.code) || room.players.length < 2) return;

  clearRoomTimer(room);

  room.round = 0;
  room.totalRounds = TOTAL_ROUNDS;
  room.status = "waiting";
  room.word = "";
  room.scrambledWord = "";
  room.difficulty = null;
  room.gameWords = createGameWordSet(room);
  room.revealedAnswer = null;
  room.roundEndsAt = null;
  room.resultsEndsAt = null;
  room.remainingMs = null;
  room.resumeStatus = null;
  room.message = "Rematch starting!";

  room.players.forEach((player) => {
    player.score = 0;
    player.answered = false;
    player.lastPoints = 0;
    player.rematchReady = false;
    player.streak = 0;
    player.lastComboBonus = 0;
    player.hints = STARTING_HINTS;
    player.revealedLetters = [];
  });

  startRound(room);
}

function checkRematch(room) {
  if (!room || room.status !== "finished") return false;
  if (room.players.length < 2) return false;

  const everyoneReady = room.players.every(
    (player) => player.rematchReady
  );

  if (!everyoneReady) return false;

  resetForRematch(room);
  return true;
}

function removePlayer(disconnectedSocket) {
  const code = disconnectedSocket.data.roomCode;
  const room = rooms.get(code);

  if (!room) return;

  room.players = room.players.filter(
    (player) => player.id !== disconnectedSocket.id
  );

  disconnectedSocket.leave(code);
  disconnectedSocket.data.roomCode = null;

  if (room.players.length === 0) {
    clearRoomTimer(room);
    rooms.delete(code);
    return;
  }

  if (room.hostId === disconnectedSocket.id) {
    room.hostId = room.players[0].id;
    room.message = `${room.players[0].name} is now the host.`;
  }

  if (
    room.players.length === 1 &&
    ["playing", "results"].includes(room.status)
  ) {
    pauseForSoloChoice(room);
    return;
  }

  if (checkRematch(room)) return;

  updateRoom(room);
}

io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on("createRoom", ({ name } = {}) => {
    name = String(name || "").trim().slice(0, 18);

    if (!name) {
      socket.emit("errorMessage", "Enter your name first.");
      return;
    }

    const code = makeCode();

    const room = {
      code,
      hostId: socket.id,

      players: [
        {
          id: socket.id,
          name,
          score: 0,
          answered: false,
          lastPoints: 0,
          rematchReady: false,
          streak: 0,
          lastComboBonus: 0,
          hints: STARTING_HINTS,
          revealedLetters: []
        }
      ],

      status: "waiting",
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      difficulty: null,
      word: "",
      scrambledWord: "",
      gameWords: [],
      recentGameWords: [],
      revealedAnswer: null,
      roundEndsAt: null,
      resultsEndsAt: null,
      remainingMs: null,
      resumeStatus: null,
      message: "",
      timer: null
    };

    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("roomCreated", { code });
    updateRoom(room);

    console.log(`[${code}] Room created by ${name}.`);
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    code = String(code || "").trim().toUpperCase();
    name = String(name || "").trim().slice(0, 18);

    const room = rooms.get(code);

    if (!name) {
      socket.emit("errorMessage", "Enter your name first.");
      return;
    }

    if (!room) {
      socket.emit("errorMessage", "Room not found. Check the code.");
      return;
    }

    if (!["waiting", "finished", "soloChoice", "paused"].includes(room.status)) {
      socket.emit(
        "errorMessage",
        "This game is already in progress. Try again after it finishes."
      );
      return;
    }

    if (room.players.length >= 8) {
      socket.emit("errorMessage", "This room is full.");
      return;
    }

    const wasPaused = ["soloChoice", "paused"].includes(room.status);

    room.players.push({
      id: socket.id,
      name,
      score: 0,
      answered: false,
      lastPoints: 0,
      rematchReady: false,
      streak: 0,
      lastComboBonus: 0,
      hints: STARTING_HINTS,
      revealedLetters: []
    });

    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[${code}] ${name} joined.`);

    if (wasPaused) {
      resumeSavedGame(room, false);
    } else {
      updateRoom(room);
    }
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room) return;

    if (socket.id !== room.hostId) {
      socket.emit("errorMessage", "Only the host can start the game.");
      return;
    }

    if (room.status !== "waiting") return;

    if (room.players.length < 2) {
      socket.emit("errorMessage", "You need at least 2 players.");
      return;
    }

    room.players.forEach((player) => {
      player.score = 0;
      player.lastPoints = 0;
      player.rematchReady = false;
      player.streak = 0;
      player.lastComboBonus = 0;
      player.hints = STARTING_HINTS;
      player.revealedLetters = [];
    });

    room.round = 0;
    room.totalRounds = TOTAL_ROUNDS;
    room.gameWords = createGameWordSet(room);

    console.log(`[${room.code}] Game started.`);

    startRound(room);
  });

  socket.on("submitAnswer", ({ answer } = {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.status !== "playing") return;

    const player = room.players.find(
      (item) => item.id === socket.id
    );

    if (!player) return;

    if (Date.now() >= room.roundEndsAt) {
      finishRound(room);
      return;
    }

    if (player.answered) {
      socket.emit("answerResult", {
        correct: false,
        message: "You've already submitted this round.",
        points: 0
      });
      return;
    }

    player.answered = true;

    const guess = String(answer || "").trim().toLowerCase();
    const correct = guess === room.word.toLowerCase();

    if (correct) {
      const remaining = Math.max(0, room.roundEndsAt - Date.now());
      const speedBonus = Math.floor(
        (remaining / ROUND_TIME_MS) * 50
      );

      player.streak += 1;

      const comboBonus =
        player.streak > 1 ? (player.streak - 1) * 20 : 0;

      const points = 100 + speedBonus + comboBonus;

      player.score += points;
      player.lastPoints = points;
      player.lastComboBonus = comboBonus;

      player.hints = (player.hints || 0) + 1;

      socket.emit("hintEarned", {
        hints: player.hints
      });

      socket.emit("answerResult", {
        correct: true,
        points,
        streak: player.streak,
        comboBonus,
        message:
          `Correct! +${points} points` +
          (comboBonus > 0
            ? ` (${comboBonus} combo bonus · ${player.streak} streak)`
            : ` (${player.streak} streak)`)
      });
    } else {
      player.lastPoints = 0;
      player.lastComboBonus = 0;
      player.streak = 0;

      socket.emit("answerResult", {
        correct: false,
        points: 0,
        streak: 0,
        comboBonus: 0,
        message: "Incorrect answer. Your streak has reset!"
      });
    }

    updateRoom(room);
  });

  socket.on("useHint", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.status !== "playing") {
      socket.emit("errorMessage", "The round is not active.");
      return;
    }

    const player = room.players.find(
      (item) => item.id === socket.id
    );

    if (!player) {
      socket.emit("errorMessage", "Player not found in this room.");
      return;
    }

    if (player.answered) {
      socket.emit("errorMessage", "You have already submitted your answer.");
      return;
    }

    if (Date.now() >= room.roundEndsAt) {
      finishRound(room);
      return;
    }

    if ((player.hints || 0) <= 0) {
      socket.emit("errorMessage", "You have no hints remaining.");
      return;
    }

    const revealed = player.revealedLetters || [];

    const availablePositions = room.word
      .split("")
      .map((_, index) => index)
      .filter((index) => !revealed.includes(index));

    if (availablePositions.length === 0) {
      socket.emit("errorMessage", "All letters are already revealed.");
      return;
    }

    const position = availablePositions[
      Math.floor(Math.random() * availablePositions.length)
    ];

    player.hints -= 1;
    player.revealedLetters = [...revealed, position];

    console.log(
      `[${room.code}] ${player.name} used a hint. Remaining: ${player.hints}`
    );

    socket.emit("hintUsed", {
      hints: player.hints,
      revealedPosition: position
    });

    updateRoom(room);
  });

  socket.on("soloPlayerChoice", ({ action } = {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.status !== "soloChoice") return;
    if (room.players.length !== 1 || room.players[0].id !== socket.id) return;

    if (action === "pause") {
      room.status = "paused";
      room.message = "Game paused. Waiting for another player to join.";
      updateRoom(room);
      return;
    }

    if (action === "continue") {
      resumeSavedGame(room, true);
      return;
    }

    if (action === "end") {
      finishGame(room, "Game ended because only one player remained.");
    }
  });

  socket.on("toggleRematchReady", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.status !== "finished") return;

    const player = room.players.find(
      (item) => item.id === socket.id
    );

    if (!player) return;

    player.rematchReady = !player.rematchReady;

    if (checkRematch(room)) return;

    updateRoom(room);
  });

  socket.on("leaveRoom", () => {
    removePlayer(socket);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    removePlayer(socket);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Word Panic server running on port ${PORT}`);
});