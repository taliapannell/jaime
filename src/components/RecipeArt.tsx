import type { Recipe } from '../types';
import type { RecipeImage } from '../hooks/useRecipeImages';
import GeneratedArt from './GeneratedArt';

/** The recipe's AI photo once ready; procedural art while generating or if generation failed. */
export default function RecipeArt({ recipe, image }: { recipe: Recipe; image?: RecipeImage }) {
  if (image?.status === 'done' && image.url) {
    return <img className="recipe-art" src={image.url} alt={`AI-generated photo of ${recipe.name}`} />;
  }
  return (
    <div className="recipe-art-wrap">
      <GeneratedArt recipe={recipe} />
      {image?.status === 'loading' && (
        <span className="recipe-art__badge" role="status">
          <span className="spinner spinner--sm" aria-hidden="true" />
          Generating photo...
        </span>
      )}
    </div>
  );
}
