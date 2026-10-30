import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import "./AudioControls.css";

const AUDIO_FILES = {
  bgm: "/audio/bgm.mp3",
  correct: "/audio/correct.mp3",
  wrong: "/audio/wrong.mp3",
  tick: "/audio/tick.mp3",
  timeout: "/audio/timeout.mp3",
  levelUp: "/audio/level-up.mp3",
  roundStart: "/audio/round-start.mp3",
  victory: "/audio/victory.mp3"
};

export default function AudioControls({ socket, room, seconds }) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [musicVolume, setMusicVolume] = useState(20);
  const [sfxVolume, setSfxVolume] = useState(65);

  const audioRef = useRef({});
  const audioEnabledRef = useRef(false);
  const musicVolumeRef = useRef(20);
  const sfxVolumeRef = useRef(65);
  const previousRoomRef = useRef({ status: null, round: null });
  const lastTickRef = useRef("");
  const timeoutRoundRef = useRef(null);
  const playSfxRef = useRef(() => {});

  // Create the audio players once.
  useEffect(() => {
    const players = {};

    Object.entries(AUDIO_FILES).forEach(([name, source]) => {
      const audio = new Audio(source);
      audio.preload = name === "bgm" ? "auto" : "metadata";
      audio.volume = name === "bgm" ? 0.2 : 0.65;

      if (name === "bgm") {
        audio.loop = true;
      }

      // Avoid unhandled playback errors if an asset is missing.
      audio.addEventListener("error", () => {
        console.warn(`Word Panic audio unavailable: ${source}`);
      });

      players[name] = audio;
    });

    audioRef.current = players;

    return () => {
      Object.values(players).forEach((audio) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });

      audioRef.current = {};
    };
  }, []);

  const playSfx = useCallback((name) => {
    if (!audioEnabledRef.current) return;

    const audio = audioRef.current[name];

    if (!audio || name === "bgm") return;

    // Restart a short effect if it is triggered again.
    audio.pause();
    audio.currentTime = 0;
    audio.volume = sfxVolumeRef.current / 100;

    audio.play().catch(() => {
      // The browser may block playback until the user interacts.
    });
  }, []);

  useEffect(() => {
    playSfxRef.current = playSfx;
  }, [playSfx]);

  // Keep the BGM volume up to date.
  useEffect(() => {
    musicVolumeRef.current = musicVolume;

    const bgm = audioRef.current.bgm;

    if (bgm) {
      bgm.volume = musicVolume / 100;
    }
  }, [musicVolume]);

  // Keep the SFX volume up to date.
  useEffect(() => {
    sfxVolumeRef.current = sfxVolume;
  }, [sfxVolume]);

  // Start or pause music according to the user's choice and game state.
  useEffect(() => {
    const bgm = audioRef.current.bgm;

    if (!bgm) return;

    const shouldPlay =
      audioEnabled &&
      room?.status !== "paused" &&
      room?.status !== "soloChoice" &&
      room?.status !== "finished";

    if (shouldPlay) {
      bgm.volume = musicVolume / 100;

      bgm.play().catch(() => {
        // The user can press AUDIO again if autoplay is blocked.
      });
    } else {
      bgm.pause();
    }
  }, [audioEnabled, musicVolume, room?.status]);

  // The master audio button is a user gesture, allowing BGM to start.
  function toggleAudio() {
    const nextEnabled = !audioEnabledRef.current;

    audioEnabledRef.current = nextEnabled;
    setAudioEnabled(nextEnabled);

    const bgm = audioRef.current.bgm;

    if (!nextEnabled) {
      if (bgm) bgm.pause();

      Object.entries(audioRef.current).forEach(([name, audio]) => {
        if (name !== "bgm") {
          audio.pause();
          audio.currentTime = 0;
        }
      });

      return;
    }

    if (
      bgm &&
      room?.status !== "paused" &&
      room?.status !== "soloChoice" &&
      room?.status !== "finished"
    ) {
      bgm.volume = musicVolumeRef.current / 100;

      bgm.play().catch(() => {
        // Music can be started again by pressing AUDIO.
      });
    }
  }

  // Play a sound when the server confirms an answer.
  useEffect(() => {
    if (!socket) return;

    const onAnswerResult = (result) => {
      playSfxRef.current(result.correct ? "correct" : "wrong");
    };

    socket.on("answerResult", onAnswerResult);

    return () => {
      socket.off("answerResult", onAnswerResult);
    };
  }, [socket]);

  // React to round and match transitions, not every room update.
  useEffect(() => {
    const previous = previousRoomRef.current;

    if (!room) {
      previousRoomRef.current = { status: null, round: null };
      return;
    }

    const roundChanged = previous.round !== room.round;
    const enteredPlaying =
      room.status === "playing" &&
      (previous.status !== "playing" || roundChanged);

    if (enteredPlaying) {
      lastTickRef.current = "";
      timeoutRoundRef.current = null;

      if ([1, 6, 11].includes(room.round)) {
        playSfxRef.current("levelUp");
      } else {
        playSfxRef.current("roundStart");
      }
    }

    if (
      room.status === "finished" &&
      previous.status !== "finished"
    ) {
      const players = room.players || [];
      const highestScore = Math.max(
        0,
        ...players.map((player) => player.score || 0)
      );

      const winners = players.filter(
        (player) => player.score === highestScore
      );

      const currentPlayerWon = winners.some(
        (player) => player.id === socket?.id
      );

      if (currentPlayerWon) {
        playSfxRef.current("victory");
      }
    }

    previousRoomRef.current = {
      status: room.status,
      round: room.round
    };
  }, [room, socket]);

  // Play at most one tick per second during the final five seconds.
  useEffect(() => {
    if (
      room?.status !== "playing" ||
      seconds < 1 ||
      seconds > 5
    ) {
      return;
    }

    const tickKey = `${room.round}-${seconds}`;

    if (lastTickRef.current !== tickKey) {
      lastTickRef.current = tickKey;
      playSfxRef.current("tick");
    }
  }, [room?.status, room?.round, seconds]);

  // Play the timeout effect once when the server's round actually expires.
  useEffect(() => {
    if (
      room?.status !== "playing" ||
      seconds !== 0 ||
      !room.roundEndsAt ||
      room.roundEndsAt > Date.now()
    ) {
      return;
    }

    if (timeoutRoundRef.current !== room.round) {
      timeoutRoundRef.current = room.round;
      playSfxRef.current("timeout");
    }
  }, [room?.status, room?.round, room?.roundEndsAt, seconds]);

return createPortal(
  <div className="audio-widget">
      <div className="audio-buttons">
        <button
          type="button"
          className={`audio-toggle ${audioEnabled ? "audio-active" : ""}`}
          onClick={toggleAudio}
          aria-pressed={audioEnabled}
          title={audioEnabled ? "Mute all game audio" : "Enable game audio"}
        >
          {audioEnabled ? "🔊 AUDIO ON" : "🔇 AUDIO OFF"}
        </button>

        <button
          type="button"
          className="audio-settings-button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-label="Toggle audio settings"
          title="Audio settings"
        >
          ⚙
        </button>
       </div>,
  document.body
);

      {settingsOpen && (
        <div className="audio-panel">
          <div className="audio-panel-heading">
            <div>
              <strong>Sound settings</strong>
              <p>Make the game sound right for you.</p>
            </div>

            <button
              type="button"
              className="audio-close"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close audio settings"
            >
              ×
            </button>
          </div>

          <label className="audio-slider-label">
            <span>🎵 Background music</span>
            <strong>{musicVolume}%</strong>
          </label>

          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={musicVolume}
            onChange={(event) =>
              setMusicVolume(Number(event.target.value))
            }
            aria-label="Background music volume"
          />

          <label className="audio-slider-label">
            <span>✨ Sound effects</span>
            <strong>{sfxVolume}%</strong>
          </label>

          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={sfxVolume}
            onChange={(event) =>
              setSfxVolume(Number(event.target.value))
            }
            aria-label="Sound effects volume"
          />

          <p className="audio-note">
            Audio is local to your device. Other players control their
            own sound settings.
          </p>
        </div>
      )}
    </div>
  );
}