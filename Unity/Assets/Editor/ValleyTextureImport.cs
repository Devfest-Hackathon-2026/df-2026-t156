using UnityEditor;
// Scoped to this landscape's CC0 maps; other project assets keep their import settings.
public sealed class ValleyTextureImport : AssetPostprocessor {
 void OnPreprocessTexture(){if(!assetPath.StartsWith("Assets/Resources/Valley/"))return;var t=(TextureImporter)assetImporter;t.maxTextureSize=1024;t.mipmapEnabled=true;t.anisoLevel=4;t.filterMode=UnityEngine.FilterMode.Trilinear;if(assetPath.Contains("Normal")){t.textureType=TextureImporterType.NormalMap;t.sRGBTexture=false;}}
}