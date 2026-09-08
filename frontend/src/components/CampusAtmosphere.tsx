import { BookOpen, Feather, PenLine, ScrollText } from 'lucide-react';

/**
 * Soft campus backdrop for all portals (student / teacher / chairman) —
 * DIU shade orbs + English-dept literary motifs.
 */
export function CampusAtmosphere() {
  return (
    <div className="campus-atmosphere" aria-hidden>
      <div className="campus-atmosphere__shade campus-atmosphere__shade--a" />
      <div className="campus-atmosphere__shade campus-atmosphere__shade--b" />
      <div className="campus-atmosphere__shade campus-atmosphere__shade--c" />
      <div className="campus-atmosphere__shade campus-atmosphere__shade--d" />

      <div className="campus-atmosphere__motif campus-atmosphere__motif--book">
        <BookOpen strokeWidth={1.2} />
      </div>
      <div className="campus-atmosphere__motif campus-atmosphere__motif--quill">
        <Feather strokeWidth={1.2} />
      </div>
      <div className="campus-atmosphere__motif campus-atmosphere__motif--scroll">
        <ScrollText strokeWidth={1.2} />
      </div>
      <div className="campus-atmosphere__motif campus-atmosphere__motif--pen">
        <PenLine strokeWidth={1.2} />
      </div>

      <p className="campus-atmosphere__motto">Sapere Aude</p>
      <span className="campus-atmosphere__quote campus-atmosphere__quote--l">❝</span>
      <span className="campus-atmosphere__quote campus-atmosphere__quote--r">❞</span>
      <span className="campus-atmosphere__spark campus-atmosphere__spark--1" />
      <span className="campus-atmosphere__spark campus-atmosphere__spark--2" />
      <span className="campus-atmosphere__spark campus-atmosphere__spark--3" />
    </div>
  );
}
