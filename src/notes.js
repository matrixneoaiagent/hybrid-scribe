// Firestore persistence for summaries and answers.
// Documents live under users/{uid}/notes/{noteId} and are protected by the
// security rules in firestore.rules (owner-only, bounded field list and sizes).

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase.js';

function notesRef(uid) {
  return collection(db, 'users', uid, 'notes');
}

export async function saveNote(uid, note) {
  const ref = await addDoc(notesRef(uid), {
    title: (note.title || 'Untitled document').slice(0, 120),
    text: note.text.slice(0, 200000),
    summary: note.summary,
    question: note.question || '',
    answer: note.answer || '',
    source: note.source || 'UNKNOWN',
    latencyMs: note.latencyMs || 0,
    chunks: note.chunks || 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function watchNotes(uid, onNext, onError) {
  const q = query(notesRef(uid), orderBy('createdAt', 'desc'), limit(25));
  return onSnapshot(
    q,
    (snapshot) => {
      onNext(
        snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() ?? null,
        })),
      );
    },
    (err) => onError?.(err),
  );
}

export function removeNote(uid, id) {
  return deleteDoc(doc(db, 'users', uid, 'notes', id));
}
