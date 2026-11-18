// Fictional public sites. Both firms have the same page topics and different facts.
// This deliberately makes an unscoped search capable of returning a plausible wrong firm.
const firms = [
  {
    id: "north",
    details: ["Tuesday and Thursday", "Gull Street", "Spanish", "maple-north.example", "Saturday mornings", "a green binder"],
  },
  {
    id: "south",
    details: ["Monday and Friday", "Fern Avenue", "Italian", "maple-south.example", "Wednesday evenings", "a blue folder"],
  },
];

const topics = [
  ["hours", d => `The telephone reception desk answers on ${d[0]} from nine to noon. The voicemail box is available outside desk hours.`,
    "On which weekdays does reception pick up the telephone?", "When can someone talk to a person at the telephone desk?"],
  ["access", d => `The step-free entrance for visitors using wheelchairs is on ${d[1]}. Its door opens automatically. The front staircase has no ramp.`,
    "Which street has the accessible entrance?", "How do wheelchair users enter without taking the stairs?"],
  ["language", d => `The community orientation leaflet is available in ${d[2]} as well as English. Request the translated booklet from the welcome desk.`,
    "Which translation of the welcome booklet is available?", "What other language is the community orientation handout printed in?"],
  ["portal", d => `The document exchange portal is hosted at ${d[3]}. Use the portal to upload files. The ordinary contact email cannot accept attachments.`,
    "Where can files be uploaded?", "How does a visitor send an attachment through the secure website?"],
  ["workshop", d => `The firm's free public library workshop runs on ${d[4]}. It is an educational group event, and booking a seat is required.`,
    "When does the public library workshop take place?", "Which session should someone reserve for the educational group event?"],
  ["lost", d => `Reception is holding ${d[5]} in its lost property cabinet. Anyone collecting a misplaced item can describe it to the receptionist.`,
    "Which misplaced item does the lost property cabinet hold?", "What object did reception put aside for its owner to collect?"],
];

const negativeQuestions = [
  "What is the menu at the neighborhood bakery?",
  "Who won the provincial curling championship?",
  "When does the ferry to the island depart?",
];

export const documents = firms.flatMap(firm => topics.map(([topic, body]) => ({
  id: `${firm.id}/${topic}`, firm: firm.id, text: body(firm.details),
})));

export const questions = firms.flatMap(firm => [
  ...topics.flatMap(([topic, , calibration, evaluation]) => [
    { firm: firm.id, text: calibration, expected: `${firm.id}/${topic}`, split: "calibration" },
    { firm: firm.id, text: evaluation, expected: `${firm.id}/${topic}`, split: "evaluation" },
  ]),
  ...negativeQuestions.map((text, i) => ({
    firm: firm.id, text, expected: null, split: i === 0 ? "calibration" : "evaluation",
  })),
]);
