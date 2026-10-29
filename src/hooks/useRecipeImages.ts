import { useEffect, useState } from 'react';
import { generateRecipeImage } from '../services/ai';
import type { Mood, Recipe } from '../types';

/** Generation state for one recipe's image; `url` is null when generation failed (UI falls back to procedural art). */
export type RecipeImage = { status: 'loading' } | { status: 'done'; url: string | null };

/** Starts generating an image for every recipe as soon as they exist, keyed by recipe id. */
export function useRecipeImages(recipes: Recipe[], mood: Mood | null): Record<string, RecipeImage> {
  const [images, setImages] = useState<Record<string, RecipeImage>>({});

  useEffect(() => {
    if (!mood || recipes.length === 0) {
      setImages({});
      return;
    }
    const abort = new AbortController();
    setImages(Object.fromEntries(recipes.map((r) => [r.id, { status: 'loading' } as RecipeImage])));
    for (const recipe of recipes) {
      generateRecipeImage(recipe, mood, abort.signal).then((url) => {
        if (abort.signal.aborted) return;
        setImages((prev) => ({ ...prev, [recipe.id]: { status: 'done', url } }));
      });
    }
    return () => abort.abort();
  }, [recipes, mood]);

  return images;
}
