import { normalizePc } from './notes';

export type HoleMapping = {
  hole: number;
  blow: number;
  draw: number;
  blowBends: number[];
  drawBends: number[];
  overblow?: number;
  overdraw?: number;
  blowMidi: number;
  drawMidi: number;
  blowBendsMidi: number[];
  drawBendsMidi: number[];
  overblowMidi?: number;
  overdrawMidi?: number;
};

// Standard 10-hole Richter layout for a C harmonica.
export const RICHTER_C_LAYOUT: HoleMapping[] = [
  {
    hole: 1,
    blow: 0,
    draw: 2,
    blowBends: [],
    drawBends: [1],
    overblow: 3,
    blowMidi: 60,
    drawMidi: 62,
    blowBendsMidi: [],
    drawBendsMidi: [61],
    overblowMidi: 63,
  },
  {
    hole: 2,
    blow: 4,
    draw: 7,
    blowBends: [],
    drawBends: [6, 5],
    overblow: 8,
    blowMidi: 64,
    drawMidi: 67,
    blowBendsMidi: [],
    drawBendsMidi: [66, 65],
    overblowMidi: 68,
  },
  {
    hole: 3,
    blow: 7,
    draw: 11,
    blowBends: [],
    drawBends: [10, 9, 8],
    overblow: 0,
    blowMidi: 67,
    drawMidi: 71,
    blowBendsMidi: [],
    drawBendsMidi: [70, 69, 68],
    overblowMidi: 72,
  },
  {
    hole: 4,
    blow: 0,
    draw: 2,
    blowBends: [],
    drawBends: [1],
    overblow: 3,
    blowMidi: 72,
    drawMidi: 74,
    blowBendsMidi: [],
    drawBendsMidi: [73],
    overblowMidi: 75,
  },
  {
    hole: 5,
    blow: 4,
    draw: 5,
    blowBends: [],
    drawBends: [4],
    overblow: 6,
    blowMidi: 76,
    drawMidi: 77,
    blowBendsMidi: [],
    drawBendsMidi: [76],
    overblowMidi: 78,
  },
  {
    hole: 6,
    blow: 7,
    draw: 9,
    blowBends: [],
    drawBends: [8],
    overblow: 10,
    blowMidi: 79,
    drawMidi: 81,
    blowBendsMidi: [],
    drawBendsMidi: [80],
    overblowMidi: 82,
  },
  {
    hole: 7,
    blow: 0,
    draw: 11,
    blowBends: [11],
    drawBends: [],
    overdraw: 1,
    blowMidi: 84,
    drawMidi: 83,
    blowBendsMidi: [83],
    drawBendsMidi: [],
    overdrawMidi: 85,
  },
  {
    hole: 8,
    blow: 4,
    draw: 2,
    blowBends: [3, 2],
    drawBends: [],
    overdraw: 5,
    blowMidi: 88,
    drawMidi: 86,
    blowBendsMidi: [87, 86],
    drawBendsMidi: [],
    overdrawMidi: 89,
  },
  {
    hole: 9,
    blow: 7,
    draw: 5,
    blowBends: [6, 5],
    drawBends: [],
    overdraw: 8,
    blowMidi: 91,
    drawMidi: 89,
    blowBendsMidi: [90, 89],
    drawBendsMidi: [],
    overdrawMidi: 92,
  },
  {
    hole: 10,
    blow: 0,
    draw: 9,
    blowBends: [11, 10, 9],
    drawBends: [],
    overdraw: 1,
    blowMidi: 96,
    drawMidi: 93,
    blowBendsMidi: [95, 94, 93],
    drawBendsMidi: [],
    overdrawMidi: 97,
  },
];

export function transposeLayout(layout: HoleMapping[], semitones: number): HoleMapping[] {
  return layout.map((hole) => ({
    hole: hole.hole,
    blow: normalizePc(hole.blow + semitones),
    draw: normalizePc(hole.draw + semitones),
    blowBends: hole.blowBends.map((pc) => normalizePc(pc + semitones)),
    drawBends: hole.drawBends.map((pc) => normalizePc(pc + semitones)),
    overblow: hole.overblow === undefined ? undefined : normalizePc(hole.overblow + semitones),
    overdraw: hole.overdraw === undefined ? undefined : normalizePc(hole.overdraw + semitones),
    blowMidi: hole.blowMidi + semitones,
    drawMidi: hole.drawMidi + semitones,
    blowBendsMidi: hole.blowBendsMidi.map((value) => value + semitones),
    drawBendsMidi: hole.drawBendsMidi.map((value) => value + semitones),
    overblowMidi: hole.overblowMidi === undefined ? undefined : hole.overblowMidi + semitones,
    overdrawMidi: hole.overdrawMidi === undefined ? undefined : hole.overdrawMidi + semitones,
  }));
}
