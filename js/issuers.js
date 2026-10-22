// Emissores de cartão de benefício, num lugar só: nome, cor e sigla no app, e como reconhecer cada um.
// Um emissor novo entra só aqui. Usado por app.js (cadastro e cores), receipt.js (leitor do celular) e gemini.js.
(() => {
  "use strict";

  // print: como aparece num comprovante ou cartão, já em MAIÚSCULAS e sem acento (leitor do celular).
  // name: como o Gemini costuma escrever o nome do emissor (mais solto).
  const LIST = [
    { name: "VR", c: "#0a8f3c", s: "VR", print: /\bVR\b|\bVR ?BENEF|\bVR ?REFEI|\bVR ?ALIMENT/, loose: /\bvr\b|vr ?benef/i },
    { name: "Alelo", c: "#5b8f00", s: "AL", print: /\bALELO\b/, loose: /alelo/i },
    { name: "Pluxee (Sodexo)", c: "#2b2a8c", s: "PX", print: /\bPLUXEE\b|\bSODEXO\b/, loose: /pluxee|sodexo/i },
    { name: "Ticket", c: "#c8102e", s: "TK", print: /\bTICKET\b/, loose: /ticket/i },
    { name: "Flash", c: "#d6246e", s: "FL", print: /\bFLASH\b/, loose: /flash/i },
    { name: "Caju", c: "#e4572e", s: "CJ", print: /\bCAJU\b/, loose: /caju/i },
    { name: "iFood Benefícios", c: "#b8121f", s: "IF", print: /\bIFOOD ?BENEF|\bIFOOD ?(?:CARD|REFEI|ALIMENT)/, loose: /ifood/i },
    { name: "Swile", c: "#5b3fd1", s: "SW", print: /\bSWILE\b/, loose: /swile/i },
    { name: "Ben", c: "#0f6fa8", s: "BN", print: /\bBEN ?(?:VISA|BENEF)/, loose: /\bben\b/i },
    { name: "Volus", c: "#00796b", s: "VL", print: /\bVOLUS\b/, loose: /volus/i },
    { name: "Valecard", c: "#e0600b", s: "VC", print: /\bVALE ?CARD\b/, loose: /vale ?card/i },
    { name: "Up Brasil", c: "#c2410c", s: "UP", print: /\bUP ?BRASIL\b|\bPOLICARD\b/, loose: /up ?brasil|policard/i },
    { name: "Verocard", c: "#1d4ed8", s: "VE", print: /\bVERO ?CARD\b/, loose: /vero ?card/i },
    { name: "Greencard", c: "#15803d", s: "GC", print: /\bGREEN ?CARD\b/, loose: /green ?card/i },
    { name: "Nutricash", c: "#a16207", s: "NC", print: /\bNUTRICASH\b/, loose: /nutricash/i },
    { name: "GoodCard", c: "#7c3aed", s: "GD", print: /\bGOOD ?CARD\b/, loose: /good ?card/i },
  ];
  const OTHER = { name: "Outro", c: "#55657a", s: "••" };

  // Qualquer emissor impresso, para achar as linhas do cartão de benefício no cupom
  const ANY_PRINT = new RegExp(LIST.map(i => i.print.source).join("|"));
  const NAMES = [...LIST.map(i => i.name), OTHER.name];
  const STYLE = Object.fromEntries([...LIST, OTHER].map(i => [i.name, { c: i.c, s: i.s }]));

  // Texto impresso (MAIÚSCULAS, sem acento) → nome do emissor
  const fromPrint = text => { for (const i of LIST) if (i.print.test(text)) return i.name; return null; };
  // Nome escrito pelo Gemini ou pela pessoa → nome do emissor
  const fromName = text => { if (!text) return null; for (const i of LIST) if (i.loose.test(text)) return i.name; return null; };

  window.Issuers = { LIST, NAMES, STYLE, ANY_PRINT, fromPrint, fromName };
})();
