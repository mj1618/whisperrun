"use client";

import { useRef, useCallback, useState } from "react";
import { TouchInputManager, getJoystickKnobPosition } from "@/engine/touch-input";

interface TouchControlsProps {
  touchInput: TouchInputManager;
  role: "runner" | "whisper";
  phase: string;
  drawModeActive?: boolean;
  onToggleDrawMode?: () => void;
}

const JOYSTICK_OUTER = 100;
const JOYSTICK_KNOB = 40;
const MAX_RADIUS = 50;

export function TouchControls({ touchInput, role, phase, drawModeActive, onToggleDrawMode }: TouchControlsProps) {
  // Whisper draw-mode toggle (mobile only, during planning or heist)
  if (role === "whisper" && (phase === "planning" || phase === "heist")) {
    return (
      <div className="fixed inset-0 z-20 pointer-events-none">
        <div className="absolute right-4 bottom-8 pointer-events-auto">
          <button
            className={`w-16 h-16 rounded-full border-2 text-xs font-bold
              flex items-center justify-center select-none
              ${drawModeActive
                ? "bg-[#00E5FF]/30 border-[#00E5FF] text-[#00E5FF]"
                : "bg-[#2D1B0E]/70 border-[#00E5FF]/50 text-[#00E5FF]/70"
              }`}
            onTouchStart={(e) => {
              e.preventDefault();
              onToggleDrawMode?.();
            }}
          >
            DRAW
          </button>
        </div>
      </div>
    );
  }

  // Only show runner controls during heist
  if (role !== "runner") return null;
  if (phase !== "heist") return null;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none">
      <JoystickArea touchInput={touchInput} />
      <ActionButtons touchInput={touchInput} />
    </div>
  );
}

function JoystickArea({ touchInput }: { touchInput: TouchInputManager }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const knobRef = useRef<{ x: number; y: number } | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const updateVisuals = useCallback((origin: { x: number; y: number }, knob: { x: number; y: number }) => {
    if (outerRef.current) {
      outerRef.current.style.left = `${origin.x - JOYSTICK_OUTER / 2}px`;
      outerRef.current.style.top = `${origin.y - JOYSTICK_OUTER / 2}px`;
    }
    if (innerRef.current) {
      innerRef.current.style.left = `${knob.x - JOYSTICK_KNOB / 2}px`;
      innerRef.current.style.top = `${knob.y - JOYSTICK_KNOB / 2}px`;
    }
  }, []);

  // After active becomes true and the joystick divs mount, apply the
  // stored origin so the ring/knob appear at the touch point immediately
  // (updateVisuals in handleTouchStart fires before the divs exist).
  const outerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    outerRef.current = node;
    if (node && originRef.current) {
      node.style.left = `${originRef.current.x - JOYSTICK_OUTER / 2}px`;
      node.style.top = `${originRef.current.y - JOYSTICK_OUTER / 2}px`;
    }
  }, []);
  const innerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (node && knobRef.current) {
      node.style.left = `${knobRef.current.x - JOYSTICK_KNOB / 2}px`;
      node.style.top = `${knobRef.current.y - JOYSTICK_KNOB / 2}px`;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const localX = touch.clientX - rect.left;
      const localY = touch.clientY - rect.top;

      touchInput.onJoystickTouchStart(touch.identifier, localX, localY);
      originRef.current = { x: localX, y: localY };
      knobRef.current = { x: localX, y: localY };
      setActive(true);
      updateVisuals({ x: localX, y: localY }, { x: localX, y: localY });
      break; // only track first new touch for joystick
    }
  }, [touchInput, updateVisuals]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const area = areaRef.current;
    if (!area || !originRef.current) return;
    const rect = area.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const localX = touch.clientX - rect.left;
      const localY = touch.clientY - rect.top;

      touchInput.onJoystickTouchMove(touch.identifier, localX, localY);

      const knob = getJoystickKnobPosition(originRef.current, localX, localY, MAX_RADIUS);
      knobRef.current = knob;
      updateVisuals(originRef.current, knob);
    }
  }, [touchInput, updateVisuals]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      touchInput.onJoystickTouchEnd(touch.identifier);
    }

    if (!touchInput.isJoystickActive()) {
      originRef.current = null;
      knobRef.current = null;
      setActive(false);
    }
  }, [touchInput]);

  return (
    <div
      ref={areaRef}
      className="absolute left-0 bottom-0 w-1/2 h-1/2 pointer-events-auto touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {active && (
        <>
          {/* Outer ring */}
          <div
            ref={outerCallbackRef}
            className="absolute rounded-full border-2 border-[#E8D5B7]/40"
            style={{ width: JOYSTICK_OUTER, height: JOYSTICK_OUTER, pointerEvents: "none" }}
          />
          {/* Inner knob */}
          <div
            ref={innerCallbackRef}
            className="absolute rounded-full bg-[#E8D5B7]/60"
            style={{ width: JOYSTICK_KNOB, height: JOYSTICK_KNOB, pointerEvents: "none" }}
          />
        </>
      )}
    </div>
  );
}

function ActionButtons({ touchInput }: { touchInput: TouchInputManager }) {
  const handleCrouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    touchInput.setCrouching(true);
  }, [touchInput]);

  const handleCrouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    touchInput.setCrouching(false);
  }, [touchInput]);

  const handleInteract = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    touchInput.triggerInteract();
  }, [touchInput]);

  return (
    <div className="absolute right-4 bottom-8 flex flex-col gap-3 pointer-events-auto">
      {/* Crouch button (hold) */}
      <button
        className="w-16 h-16 rounded-full bg-[#2D1B0E]/70 border-2 border-[#FFD700]/50
                   text-[#FFD700] text-xs font-bold active:bg-[#FFD700]/30
                   flex items-center justify-center select-none"
        onTouchStart={handleCrouchStart}
        onTouchEnd={handleCrouchEnd}
        onTouchCancel={handleCrouchEnd}
      >
        SNEAK
      </button>
      {/* Interact button */}
      <button
        className="w-16 h-16 rounded-full bg-[#2D1B0E]/70 border-2 border-[#44FF44]/50
                   text-[#44FF44] text-xs font-bold active:bg-[#44FF44]/30
                   flex items-center justify-center select-none"
        onTouchStart={handleInteract}
      >
        ACT
      </button>
    </div>
  );
}
