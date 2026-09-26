import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colourFor, splitTitle, titleParts, type FacultyColours } from '../src/facultyColours.js';
import type { MapDoc } from '../../core/model.js';

// Faculty colours from UTS academic dress (US-039 to US-041).
const uts: FacultyColours = JSON.parse(readFileSync(new URL('../../data/faculty-colours/uts.json', import.meta.url), 'utf8'));
const map: MapDoc = JSON.parse(readFileSync(new URL('../../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const IT = uts.colours.it.hex;
const BUSINESS = uts.colours.business.hex;

describe('the UTS colour table (US-041)', () => {
  it('has all ten faculty hood colours, each with where its hex came from', () => {
    expect(Object.keys(uts.colours).sort()).toEqual(
      ['business', 'communication', 'dab', 'education', 'engineering', 'health', 'it', 'law', 'science', 'transdisciplinary'].sort(),
    );
    for (const c of Object.values(uts.colours)) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(['published', 'sampled']).toContain(c.hexFrom);
    }
    expect(uts.source).toMatch(/^https:\/\/www\.uts\.edu\.au\//);
  });

  it('every rule points at a colour that exists', () => {
    for (const r of uts.rules) expect(uts.colours[r.colour], r.colour).toBeDefined();
  });
});

describe('splitting a title into its degrees (US-040)', () => {
  it('splits a double degree and leaves a single one whole', () => {
    expect(splitTitle('Bachelor of Information Technology Bachelor of Business')).toEqual(['Bachelor of Information Technology', 'Bachelor of Business']);
    expect(splitTitle('Bachelor of Engineering (Honours) Bachelor of Business')).toEqual(['Bachelor of Engineering (Honours)', 'Bachelor of Business']);
    expect(splitTitle('Bachelor of Information Technology Diploma in Industry Practice')).toEqual([
      'Bachelor of Information Technology',
      'Diploma in Industry Practice',
    ]);
    expect(splitTitle('Bachelor of Computing Science')).toEqual(['Bachelor of Computing Science']);
  });
});

describe('matching a faculty to its colour (US-039)', () => {
  it('gives Engineering and IT awards scarlet only when they are Engineering degrees', () => {
    expect(colourFor(uts, 'Engineering and Information Technology', 'Bachelor of Information Technology')).toBe('it');
    expect(colourFor(uts, 'Engineering and Information Technology', 'Bachelor of Computing Science')).toBe('it');
    expect(colourFor(uts, 'Engineering and Information Technology', 'Bachelor of Cybersecurity')).toBe('it');
    expect(colourFor(uts, 'Engineering and Information Technology', 'Bachelor of Engineering (Honours)')).toBe('engineering');
    expect(colourFor(uts, 'Business', 'Bachelor of Business')).toBe('business');
    expect(colourFor(uts, 'Somewhere Else', 'Bachelor of Things')).toBeNull();
    // Anchored: "Social Sciences" is not Science, and a comma inside a faculty's name is not a split.
    expect(colourFor(uts, 'Arts and Social Sciences', 'Bachelor of Arts in International Studies')).toBe('communication');
    expect(colourFor(uts, 'Arts and Social Sciences', 'Bachelor of Education (Primary)')).toBe('education');
    expect(colourFor(uts, 'Design, Architecture and Building', 'Bachelor of Design in Architecture')).toBe('dab');
    expect(colourFor(uts, 'TD School', 'Bachelor of Creative Intelligence and Innovation')).toBe('transdisciplinary');
    expect(colourFor(uts, 'Graduate School of Health', 'Master of Physiotherapy')).toBe('health');
  });

  it('colours each part of a double degree by its own faculty, and a mismatched one whole', () => {
    expect(titleParts(uts, { title: 'Bachelor of Information Technology Bachelor of Business', faculties: ['Engineering and Information Technology', 'Business'] })).toEqual([
      { text: 'Bachelor of Information Technology', faculty: 'Engineering and Information Technology', colour: IT },
      { text: 'Bachelor of Business', faculty: 'Business', colour: BUSINESS },
    ]);
    // Three faculties for two parts: the title cannot be split sensibly, so it takes the first colour.
    expect(titleParts(uts, { title: 'Bachelor of Information Technology Bachelor of Business', faculties: ['Business', 'Law', 'Science'] })).toEqual([
      { text: 'Bachelor of Information Technology Bachelor of Business', faculty: 'Business', colour: BUSINESS },
    ]);
  });

  it('every degree on the map has a colour for every part of its title, bar faculties listed as uncoloured', () => {
    for (const d of Object.values(map.degrees)) {
      expect(d.titleParts?.length, d.code).toBeGreaterThan(0);
      for (const p of d.titleParts!) {
        if (uts.uncoloured?.[p.faculty]) expect(p.colour, `${d.code} ${p.text}`).toBeNull();
        else expect(p.colour, `${d.code} ${p.text}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(d.titleParts!.map((p) => p.text).join(' ')).toBe(d.title);
    }
  });
});
