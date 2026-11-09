using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private sealed class LoadBackpack
    {
        public Walker Person;
        public Transform Sack,Flap,ToolRoll,Wedge;
    }

    private void RegisterBackpackEquipment(Walker person,Transform roll,Transform wedge)
    {
        foreach(var view in loadBackpacks)
            if(view.Person==person){view.ToolRoll=roll;view.Wedge=wedge;return;}
    }
    private readonly List<LoadBackpack> loadBackpacks=new List<LoadBackpack>();

    private void RegisterLoadBackpack(Walker person,Transform sack,Transform flap)
    {
        loadBackpacks.Add(new LoadBackpack {Person=person,Sack=sack,Flap=flap});
        sack.localScale=new Vector3(.72f,.78f,.32f);
        sack.localPosition=new Vector3(0,.13f,-.14f);
        flap.localScale=new Vector3(.72f,.77f,.50f);
        flap.localPosition=new Vector3(0,.46f,-.17f);
        flap.localRotation=Quaternion.Euler(-8,0,0);
    }

    private void AnimateLoadBackpacks()
    {
        UpdateTradingLights();
        float blend=1-Mathf.Exp(-12*Time.deltaTime);
        for(int i=loadBackpacks.Count-1;i>=0;i--)
        {
            var view=loadBackpacks[i];
            if(!view.Sack||!view.Person.root){loadBackpacks.RemoveAt(i);continue;}
            var person=view.Person;
            // Only the count already disclosed by the nameplate controls this
            // silhouette. No ore kind, value, hidden target or distant marker.
            int count=person.data==null?0:person.data.inventoryCount;
            int load=count<=0?0:count==1?1:2;
            Vector3 volume=load==0?new Vector3(.72f,.78f,.32f):
                load==1?Vector3.one:new Vector3(1.28f,1.12f,1.62f);
            Vector3 lidScale=load==0?new Vector3(.72f,.77f,.50f):
                load==1?Vector3.one:new Vector3(1.28f,1.08f,1.12f);
            float phase=person.step-(load==2?.55f:.18f);
            float pace=person.gearPace;
            float sway=Mathf.Sin(phase*.5f)*pace*(load==0?.8f:load==1?3.2f:2.1f);
            float bounce=Mathf.Abs(Mathf.Sin(phase))*pace*(load==0?.003f:load==1?.010f:.018f);
            float settle=0;
            if(person.data!=null&&cargoViews.TryGetValue(person.data.id,out var cargo))
            {
                float age=Time.unscaledTime-Mathf.Max(cargo.ReceivedAt,cargo.LostAt);
                if(age>=0&&age<.40f)settle=Mathf.Sin(age*19)*Mathf.Exp(-age*8);
            }
            Vector3 at=new Vector3(0,load==0?.13f:load==1?.09f:.06f,-.14f);
            at.y-=bounce+settle*.014f;
            view.Sack.localScale=Vector3.Lerp(view.Sack.localScale,volume,blend);
            view.Sack.localPosition=Vector3.Lerp(view.Sack.localPosition,at,blend);
            view.Sack.localRotation=Quaternion.Euler(load==2?-3:0,0,sway+settle*3);
            Vector3 lid=load==0?new Vector3(0,.46f,-.17f):
                load==1?new Vector3(0,.50f,-.19f):new Vector3(0,.56f,-.25f);
            lid.y-=bounce+settle*.014f;
            view.Flap.localPosition=Vector3.Lerp(view.Flap.localPosition,lid,blend);
            view.Flap.localScale=Vector3.Lerp(view.Flap.localScale,lidScale,blend);
            view.Flap.localRotation=Quaternion.Euler((load==0?-8:load==1?0:12)+settle*2,0,sway*.70f);
            if(view.ToolRoll)
            {
                var roll=new Vector3(0,load==2?-.018f:.10f,load==0?-.22f:load==1?-.25f:-.28f);
                view.ToolRoll.localPosition=Vector3.Lerp(view.ToolRoll.localPosition,roll,blend);
            }
            if(view.Wedge)
            {
                var wedge=new Vector3(load==2?.22f:.18f,.16f,load==2?-.29f:-.24f);
                view.Wedge.localPosition=Vector3.Lerp(view.Wedge.localPosition,wedge,blend);
            }
        }
    }
}
