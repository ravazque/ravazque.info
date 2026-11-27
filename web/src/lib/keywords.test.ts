import { expect, test } from "vitest";
import { keywords, plain } from "./h";

test("a title's key words, marked [[like this]], take the accent in the text and leave no mark in attributes", () => {
  const html = `<section id="s" data-name="De dónde vienen [[tus puntos]]"><h2>De dónde vienen [[tus puntos]]</h2><p class="finding"><b>14</b> [[evaluaciones]] <i data-tip="Hecho [[ya]]"></i></p></section>`;
  expect(keywords(html)).toBe(`<section id="s" data-name="De dónde vienen tus puntos"><h2>De dónde vienen <span class="kw">tus puntos</span></h2><p class="finding"><b>14</b> <span class="kw">evaluaciones</span> <i data-tip="Hecho ya"></i></p></section>`);
  expect(plain("En qué [[eres bueno]]")).toBe("En qué eres bueno");
  expect(keywords("<p>sin marca</p>")).toBe("<p>sin marca</p>");
});
