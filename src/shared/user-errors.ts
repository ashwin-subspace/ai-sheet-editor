export interface UserFacingError {
  headline: string;
  whatHappened: string;
  fixSteps: string[];
  detail?: string;
}

export function formatUserError(error: UserFacingError): string {
  const steps = error.fixSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return `${error.headline}\n\n${error.whatHappened}\n\n${steps}`;
}

export function userErrorFromMessage(message: string): UserFacingError {
  if (/connection refused|ECONNREFUSED|is not running/i.test(message)) {
    if (/Ollama/i.test(message)) {
      return {
        headline: "Ollama isn’t running",
        whatHappened: "The app could not reach Ollama on this computer.",
        fixSteps: [
          "Start the Ollama app or run `ollama serve` in a terminal.",
          "Pull a chat model, for example `ollama pull llama3.1:8b`.",
          "Click Retry setup in the assistant panel.",
        ],
        detail: message,
      };
    }
    return {
      headline: "Could not reach the model provider",
      whatHappened: "The helper could not connect to the API.",
      fixSteps: ["Check your internet connection.", "Confirm the API key is saved, then click Retry setup."],
      detail: message,
    };
  }
  if (/API key|invalid.*key|401/i.test(message)) {
    return {
      headline: "API key didn’t work",
      whatHappened: "The provider rejected the saved key.",
      fixSteps: ["Open Advanced in the toolbar.", "Paste a new API key and save it.", "Click Retry setup."],
      detail: message,
    };
  }
  if (/Choose.*model|no model|model not found/i.test(message)) {
    return {
      headline: "No chat model is ready",
      whatHappened: "A sheet-editing model is not selected or not installed.",
      fixSteps: [
        "Pick a model from the short list in the toolbar.",
        "For Ollama, pull a model such as llama3.1:8b if the list is empty.",
        "Click Retry setup.",
      ],
      detail: message,
    };
  }
  if (/file helper|8787|dev:all/i.test(message)) {
    return {
      headline: "File helper is not running",
      whatHappened: "Saving files and AI chat need the small Node program.",
      fixSteps: ["In the project folder, run `npm run dev:all`.", "Reload this page."],
      detail: message,
    };
  }
  if (/Rejected:|sheet was not changed/i.test(message)) {
    return {
      headline: "This edit wasn’t applied",
      whatHappened: "The assistant’s reply was blocked to keep the sheet safe.",
      fixSteps: [
        "Rephrase the request (shorter, one change at a time).",
        "Try table, format, or formula wording from the hint examples.",
      ],
      detail: message,
    };
  }
  return {
    headline: "Something blocked this request",
    whatHappened: "The sheet was not changed.",
    fixSteps: ["Read the detail below if you need it.", "Fix the setup issue, then try again."],
    detail: message,
  };
}
