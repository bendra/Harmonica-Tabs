import { SCALE_DEFINITIONS } from '../data/scales';
import { RICHTER_C_LAYOUT, transposeLayout } from '../data/richter';
import { normalizePc } from '../data/notes';

export type OverbendNotation = 'degree' | 'apostrophe';

export type ScaleSelection = {
  rootPc: number;
  scaleId: string;
};

type TabCandidate = {
  hole: number;
  technique: 'blow' | 'draw' | 'blow-bend' | 'draw-bend' | 'overblow' | 'overdraw';
  pc: number;
  midi: number;
  bendSemitones?: number;
};

const EXCLUDED_OVERBEND_HOLES = new Set<number>([2, 3, 8]);

function getScaleDef(scaleId: string) {
  return SCALE_DEFINITIONS.find((scale) => scale.id === scaleId);
}

function getScalePcs(rootPc: number, scaleId: string): Set<number> {
  const def = getScaleDef(scaleId);
  if (!def) {
    return new Set<number>();
  }
  return new Set(def.intervals.map((interval) => normalizePc(rootPc + interval)));
}

function formatTab(candidate: TabCandidate, notation: OverbendNotation): string {
  const prefix = candidate.technique === 'draw' || candidate.technique === 'draw-bend' || candidate.technique === 'overdraw' ? '-' : '';
  if (candidate.technique === 'overblow' || candidate.technique === 'overdraw') {
    return notation === 'degree'
      ? `${prefix}${candidate.hole}°`
      : `${prefix}${candidate.hole}'`;
  }
  if (candidate.technique === 'blow-bend' || candidate.technique === 'draw-bend') {
    const bends = "'".repeat(candidate.bendSemitones ?? 1);
    return `${prefix}${candidate.hole}${bends}`;
  }
  return `${prefix}${candidate.hole}`;
}

function shouldIncludeOverblow(hole: number): boolean {
  if (hole < 1 || hole > 6) return false;
  if (EXCLUDED_OVERBEND_HOLES.has(hole)) return false;
  return true;
}

function shouldIncludeOverdraw(hole: number): boolean {
  if (hole < 7 || hole > 10) return false;
  if (EXCLUDED_OVERBEND_HOLES.has(hole)) return false;
  return true;
}

export type TabToken = {
  tab: string;
  pc: number;
  midi: number;
  isRoot: boolean;
  hole: number;
  technique: 'blow' | 'draw' | 'blow-bend' | 'draw-bend' | 'overblow' | 'overdraw';
};

export type TabGroup = {
  pc: number;
  midi: number;
  isRoot: boolean;
  options: TabToken[];
};

export function buildTabsForScale(
  selection: ScaleSelection,
  harmonicaPc: number,
  notation: OverbendNotation,
): TabGroup[] {
  const scaleDef = getScaleDef(selection.scaleId);
  if (!scaleDef) return [];
  const scalePcs = getScalePcs(selection.rootPc, selection.scaleId);
  const layout = transposeLayout(RICHTER_C_LAYOUT, harmonicaPc);
  const tabs: TabToken[] = [];

  layout.forEach((hole) => {
    const candidates: TabCandidate[] = [];

    if (hole.blowBends.length > 0) {
      hole.blowBends.forEach((pc, index) => {
        if (!scalePcs.has(pc)) return;
        const midi = hole.blowBendsMidi[index];
        if (midi === hole.blowMidi || midi === hole.drawMidi) return;
        const steps = normalizePc(hole.blow - pc);
        candidates.push({ hole: hole.hole, technique: 'blow-bend', bendSemitones: steps, pc, midi });
      });
    }

    if (scalePcs.has(hole.blow)) {
      candidates.push({ hole: hole.hole, technique: 'blow', pc: hole.blow, midi: hole.blowMidi });
    }

    if (hole.drawBends.length > 0) {
      hole.drawBends.forEach((pc, index) => {
        if (!scalePcs.has(pc)) return;
        const midi = hole.drawBendsMidi[index];
        if (midi === hole.drawMidi || midi === hole.blowMidi) return;
        const steps = normalizePc(hole.draw - pc);
        candidates.push({ hole: hole.hole, technique: 'draw-bend', bendSemitones: steps, pc, midi });
      });
    }

    if (scalePcs.has(hole.draw)) {
      candidates.push({ hole: hole.hole, technique: 'draw', pc: hole.draw, midi: hole.drawMidi });
    }

    if (
      hole.overblow !== undefined &&
      hole.overblowMidi !== undefined &&
      scalePcs.has(hole.overblow) &&
      shouldIncludeOverblow(hole.hole)
    ) {
      candidates.push({ hole: hole.hole, technique: 'overblow', pc: hole.overblow, midi: hole.overblowMidi });
    }

    if (
      hole.overdraw !== undefined &&
      hole.overdrawMidi !== undefined &&
      scalePcs.has(hole.overdraw) &&
      shouldIncludeOverdraw(hole.hole)
    ) {
      candidates.push({ hole: hole.hole, technique: 'overdraw', pc: hole.overdraw, midi: hole.overdrawMidi });
    }

    candidates.forEach((candidate) => {
      const pc = candidate.pc;
      tabs.push({
        tab: formatTab(candidate, notation),
        pc,
        midi: candidate.midi,
        isRoot: pc === normalizePc(selection.rootPc),
        hole: candidate.hole,
        technique: candidate.technique,
      });
    });
  });
  const grouped = new Map<number, TabToken[]>();
  tabs.forEach((token) => {
    const entry = grouped.get(token.midi);
    if (entry) {
      entry.push(token);
    } else {
      grouped.set(token.midi, [token]);
    }
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([midi, options]) => {
      const sorted = [...options].sort((a, b) => {
        const rankA = getTechniqueRank(a.technique);
        const rankB = getTechniqueRank(b.technique);
        if (rankA !== rankB) return rankA - rankB;
        if (a.hole !== b.hole) return a.hole - b.hole;
        return a.tab.localeCompare(b.tab);
      });
      const pc = sorted[0]?.pc ?? normalizePc(selection.rootPc);
      return {
        pc,
        midi,
        isRoot: pc === normalizePc(selection.rootPc),
        options: sorted,
      } satisfies TabGroup;
    });
}

function getTechniqueRank(technique: TabToken['technique']): number {
  switch (technique) {
    case 'draw':
      return 0;
    case 'blow':
      return 1;
    case 'draw-bend':
      return 2;
    case 'blow-bend':
      return 3;
    case 'overdraw':
      return 4;
    case 'overblow':
      return 5;
    default:
      return 9;
  }
}
