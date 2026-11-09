using System;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;
public static class OrbitBuild {
 public static void Web(){
  foreach(var guid in AssetDatabase.FindAssets("t:Shader",new[]{"Assets/Resources"})){var path=AssetDatabase.GUIDToAssetPath(guid);var shader=AssetDatabase.LoadAssetAtPath<Shader>(path);if(shader!=null&&ShaderUtil.ShaderHasError(shader))throw new Exception("Shader compilation failed: "+path);}
  EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
  var game=new GameObject("OrbitClient");game.AddComponent<OrbitGame>();
  System.IO.Directory.CreateDirectory("Assets/Scenes");EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(),"Assets/Scenes/Orbit.unity");
  PlayerSettings.companyName="Pichu";PlayerSettings.productName="谷の採鉱競争";PlayerSettings.defaultWebScreenWidth=1280;PlayerSettings.defaultWebScreenHeight=720;
  PlayerSettings.WebGL.template="PROJECT:Orbit"; PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;PlayerSettings.WebGL.dataCaching=false;PlayerSettings.WebGL.exceptionSupport=WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;PlayerSettings.WebGL.memorySize=256;
  PlayerSettings.runInBackground=true;PlayerSettings.colorSpace=ColorSpace.Linear;
  QualitySettings.SetQualityLevel(2);QualitySettings.antiAliasing=2;QualitySettings.shadows=ShadowQuality.Disable;
  EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Scenes/Orbit.unity",true)};
  var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Scenes/Orbit.unity"},locationPathName="../build-web",target=BuildTarget.WebGL,options=BuildOptions.None});
  if(report.summary.result!=BuildResult.Succeeded)throw new Exception("WebGL build failed: "+report.summary.result);
  Debug.Log("ORBIT_WEB_BUILD_SUCCEEDED "+report.summary.totalSize);
 }
}
