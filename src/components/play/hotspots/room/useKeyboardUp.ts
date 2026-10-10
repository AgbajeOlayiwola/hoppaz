"use client";

import { useEffect, useState } from "react";

/** A window shorter than this, with a text box focused, is a window with a keyboard in it. */
const SHORT_WINDOW = 560;

const isTextBox = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && /^(text|search|email|url|tel|password|number)$/.test(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable));

/**
 * True while the phone's keyboard is up, so the room can hide the junction stage and keep the room the keyboard left for
 * the chat. Two kinds of keyboard: one that shrinks the visual viewport and leaves the window alone (iOS Safari), and one
 * that shrinks the window itself (Android Chrome, and the in-app browsers of Instagram and Facebook), where the visual
 * viewport matches the window and only the window's height tells. For the second a focused text box in a window under
 * 560 px tall counts.
 */
export function useKeyboardUp() {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const check = () => {
      const shrunk = !!vv && vv.scale <= 1.01 && window.innerHeight - vv.height > 140;
      setUp(shrunk || (isTextBox(document.activeElement) && window.innerHeight < SHORT_WINDOW));
    };
    // Focus moves to the next element a moment after focusout, so read it after that.
    const later = () => setTimeout(check, 0);
    check();
    vv?.addEventListener("resize", check);
    window.addEventListener("resize", check);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    return () => {
      vv?.removeEventListener("resize", check);
      window.removeEventListener("resize", check);
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return up;
}
