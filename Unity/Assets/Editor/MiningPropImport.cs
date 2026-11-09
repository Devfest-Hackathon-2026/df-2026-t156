using UnityEditor;
using UnityEngine;
// Only the selected CC0 mining-prop maps; no changes to existing materials/assets.
public sealed class MiningPropImport : AssetPostprocessor
{
 void OnPreprocessTexture()
 {
  if(!assetPath.StartsWith("Assets/Resources/MiningProps/")) return;
  var texture=(TextureImporter)assetImporter;
  texture.maxTextureSize=1024;texture.mipmapEnabled=true;
  texture.filterMode=FilterMode.Trilinear;texture.anisoLevel=2;
  if(assetPath.Contains("Normal")) {texture.textureType=TextureImporterType.NormalMap;texture.sRGBTexture=false;}
  else if(assetPath.Contains("Metallic")||assetPath.Contains("Roughness")) texture.sRGBTexture=false;
 }
 void OnPreprocessModel()
 {
  if(!assetPath.StartsWith("Assets/Resources/MiningProps/")) return;
  var model=(ModelImporter)assetImporter;
  model.importAnimation=false;model.materialImportMode=ModelImporterMaterialImportMode.None;
  model.importCameras=false;model.importLights=false;
 }
}
