function render(){
 const qs=new URLSearchParams(location.search);
 if(qs.get("judge")==="1"){ if(typeof renderJudge === "function") renderJudge(); return; }
 const isPublic=qs.get("display")==="public";
 if(isPublic){
   if(!document.getElementById("publicRoot")) renderPublic();
   renderPublicScreen();
 }else{
   renderOperator();
 }
}

const _qs=new URLSearchParams(location.search);
if(_qs.get("judge")==="1"){ if(typeof renderJudge === "function") renderJudge(); }
else if(_qs.get("display")==="public") renderPublic();
else {renderOperator();bindSync()}
