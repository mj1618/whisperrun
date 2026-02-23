"use client";

import { useEffect, useRef } from "react";
import { GameLoop } from "@/engine/loop";
import { Renderer, TILE_SIZE } from "@/engine/renderer";
import { Camera } from "@/engine/camera";
import { InputHandler } from "@/engine/input";
import { TEST_MAP, getMapWidth, getMapHeight } from "@/game/map";

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const camera = new Camera();
    const renderer = new Renderer(canvas, camera);
    const input = new InputHandler();

    // Size canvas to window
    const resize = () => {
      renderer.resize(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    // Center camera on the map
    const mapPixelWidth = getMapWidth(TEST_MAP) * TILE_SIZE;
    const mapPixelHeight = getMapHeight(TEST_MAP) * TILE_SIZE;
    camera.centerOn(mapPixelWidth / 2, mapPixelHeight / 2);

    input.attach();

    // Scroll speed in pixels/second
    const SCROLL_SPEED = 200;

    const update = (dt: number) => {
      input.update();

      // Allow arrow/WASD scrolling to explore the map
      if (input.isKeyDown("ArrowUp") || input.isKeyDown("KeyW")) {
        camera.y -= SCROLL_SPEED * dt;
      }
      if (input.isKeyDown("ArrowDown") || input.isKeyDown("KeyS")) {
        camera.y += SCROLL_SPEED * dt;
      }
      if (input.isKeyDown("ArrowLeft") || input.isKeyDown("KeyA")) {
        camera.x -= SCROLL_SPEED * dt;
      }
      if (input.isKeyDown("ArrowRight") || input.isKeyDown("KeyD")) {
        camera.x += SCROLL_SPEED * dt;
      }
    };

    const render = () => {
      renderer.clear();
      renderer.drawTileMap(TEST_MAP);
    };

    const loop = new GameLoop(update, render);
    loop.start();

    return () => {
      loop.stop();
      input.detach();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
