
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";
import AudioControls from "./AudioControls";

const socket = io(
  import.meta.env.VITE_SERVER_URL || "http://localhost:3001",
  { autoConnect: false }
);

const LEVEL_INFO = {
  Easy: {
    emoji: "🟢",
    title: "EASY MODE",
    rounds: "ROUNDS 1–5",
    subtitle: "Warm up. Find your rhythm.",
    className: "easy"
  },
  Medium: {
    emoji: "🟡",
    title: "MEDIUM MODE",
    rounds: "ROUNDS 6–10",
    subtitle: "Think faster. The challenge is rising.",
    className: "medium"
  },
  Hard: {
    emoji: "🔴",
    title: "HARD MODE",
    rounds: "ROUNDS 11–15",
    subtitle: "The final challenge starts now!",
    className: "hard"
  }
};

function getLevelForRound(round) {
  if (round <= 5) return "Easy";
  if (round <= 10) return "Medium";
  return "Hard";
}

export default function App() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [connected, setConnected] = useState(false);

  const [showHowToPlay, setShowHowToPlay] = useState(true);
  const [levelIntro, setLevelIntro] = useState(null);
  const [hintEarnedPopup, setHintEarnedPopup] = useState(false);

  useEffect(() => {
    socket.connect();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onCreated = ({ code: roomCode }) => setCode(roomCode);

    const onUpdate = (data) => {
      console.log("ROOM UPDATE:", {
        status: data.status,
        round: data.round,
        totalRounds: data.totalRounds,
        difficulty: data.difficulty,
        revealedAnswer: data.revealedAnswer
      });

      setRoom(data);
    };

    const onError = (message) => setError(message);

    const onResult = (result) => {
      setFeedback(result.message);
      setFeedbackType(result.correct ? "success" : "error");
    };

    const onHintEarned = () => {
      setHintEarnedPopup(true);

      setTimeout(() => {
        setHintEarnedPopup(false);
      }, 1800);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomCreated", onCreated);
    socket.on("roomUpdated", onUpdate);
    socket.on("errorMessage", onError);
    socket.on("answerResult", onResult);
    socket.on("hintEarned", onHintEarned);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("roomCreated", onCreated);
      socket.off("roomUpdated", onUpdate);
      socket.off("errorMessage", onError);
      socket.off("answerResult", onResult);
      socket.off("hintEarned", onHintEarned);
      socket.disconnect();
    };
  }, []);

  // Clear answer feedback whenever the round or game status changes.
  useEffect(() => {
    setAnswer("");
    setFeedback("");
    setFeedbackType("");
  }, [room?.round, room?.status]);

  // Animate a level-intro popup at the beginning of each difficulty.
  useEffect(() => {
    if (room?.status !== "playing") {
      setLevelIntro(null);
      return;
    }

    const round = room.round;

    if (![1, 6, 11].includes(round)) {
      setLevelIntro(null);
      return;
    }

    const level = room.difficulty || getLevelForRound(round);
    const info = LEVEL_INFO[level];

    if (!info) return;

    setLevelIntro({
      ...info,
      level,
      round
    });

    const timer = setTimeout(() => {
      setLevelIntro(null);
    }, 1800);

    return () => clearTimeout(timer);
  }, [room?.round, room?.status, room?.difficulty]);

  // Countdown synced to the server's round end time.
  useEffect(() => {
    if (!room || room.status !== "playing" || !room.roundEndsAt) {
      setSeconds(30);
      return;
    }

    const updateTime = () => {
      setSeconds(
        Math.max(
          0,
          Math.ceil((room.roundEndsAt - Date.now()) / 1000)
        )
      );
    };

    updateTime();

    const timer = setInterval(updateTime, 200);
    return () => clearInterval(timer);
  }, [room?.roundEndsAt, room?.status]);

  function createRoom() {
    setError("");
    setFeedback("");
    setRoom(null);

    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    socket.emit("createRoom", { name });
  }

  function joinRoom() {
    setError("");
    setFeedback("");
    setRoom(null);

    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    if (!code.trim()) {
      setError("Enter a room code first.");
      return;
    }

    socket.emit("joinRoom", { name, code });
  }

  function startGame() {
    setError("");
    setFeedback("");
    socket.emit("startGame");
  }

  function submitAnswer(event) {
    event.preventDefault();

    if (!answer.trim() || !room || room.status !== "playing") {
      return;
    }

    if (seconds <= 0 || me?.answered) return;

    socket.emit("submitAnswer", { answer });
    setAnswer("");
  }

  function useHint() {
    if (!room || room.status !== "playing") return;
    if (!me || me.answered || (me.hints || 0) <= 0) return;
    if (seconds <= 0) return;

    setError("");
    socket.emit("useHint");
  }

  function toggleRematch() {
    setError("");
    setFeedback("");
    socket.emit("toggleRematchReady");
  }

  function chooseSoloAction(action) {
    setError("");
    setFeedback("");
    socket.emit("soloPlayerChoice", { action });
  }

  function exitToLobby() {
    socket.emit("leaveRoom");
    setRoom(null);
    setCode("");
    setAnswer("");
    setFeedback("");
    setFeedbackType("");
    setError("");
    setLevelIntro(null);
    setHintEarnedPopup(false);
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setFeedback("Room code copied!");
      setFeedbackType("success");
    } catch {
      setFeedback(`Share this room code: ${room.code}`);
      setFeedbackType("success");
    }
  }

  const me = room?.players.find(
    (player) => player.id === socket.id
  );

  const alreadyAnswered = me?.answered ?? false;
  const rematchReady = me?.rematchReady ?? false;
  const hintsAvailable = me?.hints ?? 5;
  const revealedWord = me?.revealedWord ?? [];

  const leaderboard = [...(room?.players ?? [])].sort(
    (a, b) => b.score - a.score
  );

  const topScore = leaderboard[0]?.score ?? 0;

  const winners = leaderboard.filter(
    (player) => player.score === topScore
  );

  const readyCount =
    room?.players.filter((player) => player.rematchReady).length ?? 0;

  const difficulty =
    room?.difficulty || getLevelForRound(room?.round || 1);

  return (
    <main className="page">
      <AudioControls socket={socket} room={room} seconds={seconds} />

      {/* HINT EARNED POPUP */}
      {hintEarnedPopup && (
        <div className="hint-earned-popup">
          <span className="hint-earned-icon">💡</span>
          <div>
            <strong>+1 HINT EARNED!</strong>
            <p>Correct answer. Keep going!</p>
          </div>
        </div>
      )}

      {/* WELCOME / HOW TO PLAY POPUP */}
      {showHowToPlay && (
        <div
          className="how-to-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-to-title"
        >
          <div className="how-to-modal">
            <div className="how-to-header">
              <div className="how-to-logo">W!</div>

              <div>
                <p className="how-to-eyebrow">WELCOME TO</p>
                <h2 id="how-to-title">WORD PANIC</h2>
                <p className="how-to-tagline">
                  Think fast. Unscramble. Win.
                </p>
              </div>
            </div>

            <p className="how-to-intro">
              Race against the clock, solve scrambled words, and compete
              with your friends. Every level gets tougher until one player
              becomes the Word Panic Champion.
            </p>

            <div className="how-to-steps">
              <div className="how-to-step">
                <span className="how-to-number">01</span>
                <div>
                  <h3>Create or Join a Room</h3>
                  <p>
                    Enter your nickname. Create a room and share its code,
                    or join a friend's room. Play with 2–8 players.
                  </p>
                </div>
              </div>

              <div className="how-to-step">
                <span className="how-to-number">02</span>
                <div>
                  <h3>Easy — Rounds 1–5</h3>
                  <p>
                    Begin with short, familiar words to warm up.
                  </p>
                </div>
              </div>

              <div className="how-to-step">
                <span className="how-to-number">03</span>
                <div>
                  <h3>Medium — Rounds 6–10</h3>
                  <p>
                    Words get longer and trickier. Think quickly to score.
                  </p>
                </div>
              </div>

              <div className="how-to-step">
                <span className="how-to-number">04</span>
                <div>
                  <h3>Hard — Rounds 11–15</h3>
                  <p>
                    Solve the toughest words in the final five rounds.
                  </p>
                </div>
              </div>

              <div className="how-to-step">
                <span className="how-to-number">05</span>
                <div>
                  <h3>Score Points and Win</h3>
                  <p>
                    Correct answers earn 100 base points, up to 50 speed
                    bonus points, and combo bonuses for consecutive correct
                    answers. The highest total score wins.
                  </p>
                </div>
              </div>
            </div>

            <div className="how-to-score">
              <div>
                <strong>+100</strong>
                <span>Base points</span>
              </div>

              <div>
                <strong>+50</strong>
                <span>Maximum speed bonus</span>
              </div>

              <div>
                <strong>+20</strong>
                <span>Combo per streak step</span>
              </div>
            </div>

            <p className="how-to-footer">
              15 ROUNDS <span>•</span> 30 SECONDS EACH <span>•</span> 2–8 PLAYERS
            </p>

            <button
              className="primary-button how-to-start"
              onClick={() => setShowHowToPlay(false)}
            >
              LET'S PLAY <span>→</span>
            </button>

            <button
              className="how-to-skip"
              onClick={() => setShowHowToPlay(false)}
            >
              Skip instructions
            </button>
          </div>
        </div>
      )}

      {/* ANIMATED INTRO WHEN EACH LEVEL STARTS */}
      {levelIntro && (
        <div className="level-intro-overlay" aria-live="polite">
          <div
            key={`${levelIntro.level}-${levelIntro.round}`}
            className={`level-intro-card level-intro-${levelIntro.className}`}
          >
            <div className="level-intro-flash" />
            <div className="level-intro-emoji">
              {levelIntro.emoji}
            </div>
            <p className="level-intro-kicker">GET READY</p>
            <h2>{levelIntro.title}</h2>
            <p className="level-intro-rounds">{levelIntro.rounds}</p>
            <p className="level-intro-subtitle">
              {levelIntro.subtitle}
            </p>

            <div className="level-intro-progress">
              <span />
            </div>
          </div>
        </div>
      )}

      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">W!</span>
          WORD PANIC
        </a>

        <span className={`connection ${connected ? "online" : ""}`}>
          <span className="status-dot" />
          {connected ? "SERVER CONNECTED" : "CONNECTING..."}
        </span>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span />
          THINK FAST. TYPE FASTER.
        </div>

        <h1>
          Words under
          <br />
          <span>pressure.</span>
        </h1>

        <p>
          Unscramble the letters, beat the clock, and outscore your
          friends. One word can change everything.
        </p>
      </section>

      {!room ? (
        <section className="lobby panel">
          <div className="section-label">YOUR NEXT CHALLENGE</div>

          <label htmlFor="playerName">PLAYER NAME</label>

          <input
            id="playerName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Enter your nickname"
            maxLength={18}
          />

          <button
            className="primary-button"
            onClick={createRoom}
            disabled={!connected}
          >
            CREATE A ROOM <span>↗</span>
          </button>

          <div className="or-divider">
            <span />
            OR JOIN YOUR FRIENDS
            <span />
          </div>

          <div className="join-row">
            <input
              value={code}
              onChange={(event) =>
                setCode(event.target.value.toUpperCase())
              }
              placeholder="ROOM CODE"
              maxLength={6}
            />

            <button
              className="secondary-button"
              onClick={joinRoom}
              disabled={!connected}
            >
              JOIN
            </button>
          </div>

          <p className="hint">
            2–8 players · 15 rounds · 30 seconds per round
          </p>

          {error && <p className="error-message">{error}</p>}
        </section>
      ) : (
        <section className="game-layout">
          <div className="game-main panel">
            <div className="room-heading">
              <div>
                <div className="section-label">ROOM CODE</div>
                <div className="room-code">{room.code}</div>
              </div>

              <button className="copy-button" onClick={copyRoomCode}>
                COPY CODE
              </button>
            </div>

            {/* WAITING ROOM */}
            {room.status === "waiting" && (
              <div className="waiting-state">
                <div className="waiting-icon">⌛</div>
                <h2>Waiting for players</h2>
                <p>Share the room code with a friend to get started.</p>

                <div className="waiting-players">
                  {room.players.map((player) => (
                    <div className="waiting-player" key={player.id}>
                      <span className="player-avatar">
                        {player.name.charAt(0).toUpperCase()}
                      </span>

                      <span>{player.name}</span>

                      {player.id === room.hostId && (
                        <span className="host-tag">HOST</span>
                      )}
                    </div>
                  ))}
                </div>

                {room.hostId === socket.id ? (
                  <button
                    className="primary-button"
                    onClick={startGame}
                    disabled={room.players.length < 2}
                  >
                    {room.players.length < 2
                      ? "WAITING FOR PLAYER 2"
                      : "START GAME →"}
                  </button>
                ) : (
                  <p className="hint">
                    The host will start the game soon.
                  </p>
                )}
              </div>
            )}

            {/* LAST PLAYER OPTIONS */}
            {room.status === "soloChoice" && (
              <div className="waiting-state">
                <div className="waiting-icon">👥</div>
                <p className="instruction">YOU'RE THE LAST PLAYER</p>
                <h2>What would you like to do?</h2>
                <p>
                  The other players have disconnected. Your score and round
                  progress are safe.
                </p>

                <div className="solo-choice-actions">
                  <button
                    className="primary-button"
                    onClick={() => chooseSoloAction("pause")}
                  >
                    PAUSE & WAIT
                  </button>

                  <button
                    className="primary-button"
                    onClick={() => {
                      if (window.confirm("Continue the match alone?")) {
                        chooseSoloAction("continue");
                      }
                    }}
                  >
                    CONTINUE SOLO
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() => {
                      if (window.confirm("End the game now?")) {
                        chooseSoloAction("end");
                      }
                    }}
                  >
                    END GAME
                  </button>
                </div>

                <p className="hint">
                  Share the room code if you want someone to rejoin.
                </p>
              </div>
            )}

            {/* PAUSED GAME */}
            {room.status === "paused" && (
              <div className="waiting-state">
                <div className="waiting-icon">⏸</div>
                <p className="instruction">GAME PAUSED</p>
                <h2>Waiting for another player</h2>

                <p>
                  Your game is paused and your progress is safe. Share the
                  room code above so another player can join. The game will
                  resume automatically when they join.
                </p>

                <div className="room-code">{room.code}</div>

                <button className="copy-button" onClick={copyRoomCode}>
                  COPY ROOM CODE
                </button>

                <p className="hint">
                  Your current round and score will be preserved.
                </p>

                <div className="solo-choice-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      if (window.confirm("Continue the match alone?")) {
                        chooseSoloAction("continue");
                      }
                    }}
                  >
                    CONTINUE SOLO
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() => {
                      if (window.confirm("End the game now?")) {
                        chooseSoloAction("end");
                      }
                    }}
                  >
                    END GAME
                  </button>
                </div>
              </div>
            )}

            {/* ACTIVE ROUND */}
            {room.status === "playing" && (
              <div className="round-area">
                <div
                  className={`difficulty-pill difficulty-${difficulty.toLowerCase()}`}
                >
                  {LEVEL_INFO[difficulty]?.emoji} {difficulty.toUpperCase()} LEVEL
                </div>

                <div className="round-meta">
                  <span>
                    ROUND {room.round} / {room.totalRounds}
                  </span>

                  <span className={seconds <= 15 ? "urgent" : ""}>
                    00:{String(seconds).padStart(2, "0")}
                  </span>
                </div>

                {seconds <= 15 && (
                  <p className="timer-warning">15 SECONDS LEFT!</p>
                )}

                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${(seconds / 30) * 100}%`
                    }}
                  />
                </div>

                <p className="instruction">UNSCRAMBLE THIS WORD</p>

                {/* PERSONAL HINTS */}
                <div className="hint-controls">
                  <div className="hint-balance">
                    <span className="hint-bulb">💡</span>
                    <div>
                      <strong>{hintsAvailable}</strong>
                      <small>HINTS AVAILABLE</small>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="use-hint-button"
                    onClick={useHint}
                    disabled={
                      alreadyAnswered ||
                      seconds === 0 ||
                      hintsAvailable <= 0
                    }
                  >
                    💡 HINT
                  </button>
                </div>

                {/* SCRAMBLED WORD */}
                <div className="scrambled-word">
                  {room.scrambledWord.split("").map((letter, index) => (
                    <span
                      className="letter-tile"
                      key={`${room.round}-${index}`}
                    >
                      {letter}
                    </span>
                  ))}
                </div>

                {revealedWord.some(Boolean) && (
                  <div className="revealed-word">
                    <p>YOUR LETTER CLUE</p>

                    <div className="revealed-letters">
                      {revealedWord.map((letter, index) => (
                        <span
                          key={`${room.round}-hint-${index}`}
                          className={letter ? "revealed-letter" : ""}
                        >
                          {letter || "_"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <form className="answer-form" onSubmit={submitAnswer}>
                  <input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Type your answer..."
                    autoComplete="off"
                    disabled={alreadyAnswered || seconds === 0}
                  />

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={alreadyAnswered || seconds === 0}
                  >
                    SUBMIT ↗
                  </button>
                </form>

                {alreadyAnswered && (
                  <p className="hint">
                    Answer submitted. Wait for the next round.
                  </p>
                )}

                {feedback && (
                  <p className={`feedback ${feedbackType}`}>
                    {feedback}
                  </p>
                )}
              </div>
            )}

            {/* ROUND RESULTS */}
            {room.status === "results" && (
              <div className="round-results">
                <div className="results-icon">✓</div>

                <p className="instruction">
                  {difficulty.toUpperCase()} LEVEL · ROUND {room.round} COMPLETE
                </p>

                <h2>THE WORD WAS</h2>

                <div className="answer-reveal">
                  {room.revealedAnswer}
                </div>

                <p className="results-message">
                  {room.round === 5
                    ? "Easy level complete! Medium words are coming next."
                    : room.round === 10
                      ? "Medium level complete! Get ready for Hard mode."
                      : room.round < room.totalRounds
                        ? "Get ready. The next round is coming!"
                        : "All 15 rounds completed! Time to crown the champion."}
                </p>

                <div className="results-scoreboard">
                  <h3>UPDATED LEADERBOARD</h3>

                  {leaderboard.map((player, index) => (
                    <div className="results-player" key={player.id}>
                      <span className="results-rank">
                        #{index + 1}
                      </span>

                      <span className="results-player-name">
                        {player.name}
                        {player.id === socket.id ? " (You)" : ""}
                      </span>

                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
                </div>

                <div className="next-round-indicator">
                  <span className="pulse-dot" />
                  NEXT ROUND IN 4 SECONDS
                </div>
              </div>
            )}

            {/* FINAL RESULTS */}
            {room.status === "finished" && (
              <div className="final-results">
                <div className="trophy-icon">🏆</div>

                <p className="instruction">
                  FIFTEEN ROUNDS. ONE FINAL SCORE.
                </p>

                <h2>
                  {room.message?.includes("Game ended")
                    ? "GAME ENDED"
                    : "GAME OVER"}
                </h2>

                {room.message?.includes("Game ended") && (
                  <p className="results-message">{room.message}</p>
                )}

                {winners.length === 1 ? (
                  <>
                    <p className="winner-label">
                      THE WORD PANIC CHAMPION
                    </p>

                    <div className="winner-name">
                      {winners[0].name}
                    </div>

                    <div className="winner-score">
                      {topScore} POINTS
                    </div>
                  </>
                ) : (
                  <>
                    <p className="winner-label">IT'S A TIE!</p>

                    <div className="winner-name">
                      {winners.map((player) => player.name).join(" & ")}
                    </div>

                    <div className="winner-score">
                      {topScore} POINTS EACH
                    </div>
                  </>
                )}

                <div className="results-scoreboard">
                  <h3>FINAL LEADERBOARD</h3>

                  {leaderboard.map((player, index) => (
                    <div className="results-player" key={player.id}>
                      <span className="results-rank">
                        #{index + 1}
                      </span>

                      <span className="results-player-name">
                        {player.name}
                        {player.id === socket.id ? " (You)" : ""}
                      </span>

                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
                </div>

                <div className="rematch-section">
                  <h3>REMATCH?</h3>

                  <p className="results-message">
                    {rematchReady
                      ? "You're ready! Waiting for the other players."
                      : "Ready to challenge your friends again?"}
                  </p>

                  <p className="hint">
                    {readyCount} of {room.players.length} players ready
                  </p>

                  <button
                    className="primary-button"
                    onClick={toggleRematch}
                  >
                    {rematchReady
                      ? "CANCEL READY"
                      : "READY FOR REMATCH →"}
                  </button>

                  <p className="hint">
                    A fresh 15-round match starts when everyone is ready.
                    Your room code stays the same.
                  </p>
                </div>

                <button
                  className="secondary-button"
                  onClick={exitToLobby}
                >
                  LEAVE ROOM
                </button>
              </div>
            )}

            {error && <p className="error-message">{error}</p>}
          </div>

          {/* LIVE LEADERBOARD */}
          <aside className="leaderboard panel">
            <div className="section-label">LIVE RANKINGS</div>

            <h2>
              Leaderboard <span>↗</span>
            </h2>

            {leaderboard.map((player, index) => (
              <div className="player-row" key={player.id}>
                <div className={`rank rank-${index + 1}`}>
                  {index + 1}
                </div>

                <div className="player-info">
                  <strong>
                    {player.name}
                    {player.id === socket.id ? " (You)" : ""}
                  </strong>

                  <small>
                    {player.id === room.hostId ? "HOST" : "PLAYER"}
                  </small>
                </div>

                <strong className="score">{player.score}</strong>
              </div>
            ))}

            <p className="hint">
              Correct answer: 100 base points + speed bonus + combo bonus
            </p>
          </aside>
        </section>
      )}

      <footer>
        <span>WORD PANIC © 2026</span>
        <span>MADE FOR QUICK THINKERS.</span>
      </footer>
    </main>
  );
}
