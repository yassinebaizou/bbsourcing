(function(){
  var now=Date.now(), iso=function(d){return new Date(now-d*864e5).toISOString();};
  var M = window.__MOCK = window.__MOCK || {};
  var uid="u-admin";
  var statuses=[["new_application",1,"New application","Received"],["under_review",2,"Under review","Under review"],["contacted",3,"Contacted","Under review"],["sourcing",4,"Sourcing","Under review"],["feasible",5,"Feasible","Quotation in preparation"],["quote_prep",6,"Quote prep","Quotation in preparation"],["quote_sent",7,"Quote sent","Quotation ready"],["awaiting_deposit",8,"Awaiting deposit","Awaiting 40% deposit"],["deposit_confirmed",9,"Deposit confirmed","Order placed"],["inspection",10,"Inspection","Quality inspection"],["shipped",11,"Shipped","In transit"],["customs",12,"Customs","In transit"],["arrived",13,"Arrived","Arrived in Morocco"],["awaiting_final",14,"Awaiting final","Awaiting 60% payment"],["final_confirmed",15,"Final confirmed","Out for delivery"],["out_for_delivery",16,"Out for delivery","Out for delivery"],["completed",17,"Completed","Delivered"],["not_qualified",99,"Not qualified","Closed"]].map(function(s){return {code:s[0],rank:s[1],label:s[2],client_stage:s[3]};});
  var client={full_name:"Sara B",email:"sara@x.ma",whatsapp:"+212612345678",city:"Rabat",business_name:"SB Store",created_at:iso(90)};
  var db={
    request_statuses:statuses,
    profiles:[{id:uid,full_name:"Yassine",email:"y@x.ma",city:"Casablanca"},Object.assign({id:"c1"},client)],
    staff:[{user_id:uid,role:"admin",active:true,created_at:iso(100),profile:{full_name:"Yassine",email:"y@x.ma"}}],
    requests:[
      {id:"r1",code:"DDP-0001",client_id:"c1",product_name:"Earbuds",category:"gadget",quantity:300,estimated_value_mad:9000,status:"completed",created_at:iso(60),delivery_city:"Rabat",assigned_to:uid,quote_amount_mad:20000,client:client,payment:{request_id:"r1",final_price_mad:20000,deposit_amount_mad:8000,balance_amount_mad:12000,deposit_status:"verified",final_status:"verified",deposit_verified_at:iso(55),final_verified_at:iso(40)},internal:null},
      {id:"r2",code:"DDP-0002",client_id:"c1",product_name:"Lamp",category:"home",quantity:50,estimated_value_mad:2000,status:"new_application",created_at:iso(2),delivery_city:"Rabat",below_minimum:true,client:client,payment:null,internal:null},
      {id:"r3",code:"DDP-0003",client_id:"c1",product_name:"Bags",category:"textile",quantity:200,estimated_value_mad:12000,status:"shipped",created_at:iso(30),delivery_city:"Fes",assigned_to:uid,quote_amount_mad:30000,client:client,payment:{request_id:"r3",final_price_mad:30000,deposit_amount_mad:12000,balance_amount_mad:18000,deposit_status:"verified",final_status:"not_due",deposit_verified_at:iso(25)},internal:{request_id:"r3",next_action:"Call",next_action_at:iso(1)}}
    ],
    request_messages:[{id:"m1",request_id:"r3",from_team:false,kind:"message",body:"Hello when?",created_at:iso(1)},{id:"m2",request_id:"r3",from_team:true,kind:"update",body:"Status update: In transit",created_at:iso(3)},{id:"m3",request_id:"r2",from_team:true,kind:"message",body:"We got it",created_at:iso(1)}],
    message_reads:[], order_costs:[{request_id:"r1",product_cost_mad:9000,air_freight_mad:3000,total_cost_mad:13000}],
    reviews:[{id:"rv1",client_id:"c1",headline:"Fast and honest",body:"My earbuds arrived in 17 days, all good.",media_path:"c1/a.jpg",media_type:"image",display_name:"Sara B.",city:"Rabat",store_name:"SB Store",status:"pending",created_at:iso(1),client:{full_name:"Sara B",email:"sara@x.ma"}},{id:"rv2",client_id:"c1",headline:"Second order",body:"Again on time and well packed.",media_path:null,media_type:null,display_name:"Sara B.",status:"approved",reviewed_at:iso(2),created_at:iso(3),client:{full_name:"Sara B",email:"sara@x.ma"}}], payments:[], request_events:[], request_notes:[], request_files:[], request_internal:[]
  };
  if (M.extraStatuses) db.request_statuses = db.request_statuses.concat(M.extraStatuses);
  if (M.extraTables) Object.keys(M.extraTables).forEach(function(k){ db[k] = M.extraTables[k]; });
  if (M.emptyRequests) db.requests = [];
  db.failed_pending_requests = M.failedRows || [];
  if (M.addRequests) db.requests = M.addRequests.concat(db.requests);
  M.db=db; M.calls=[];
  function B(t){ this.t=t; this.f=[]; this.op="select"; this.one=false; }
  ["select","order","range","limit","in","gte","lte","neq","is","or","not","ilike"].forEach(function(m){ B.prototype[m]=function(){ if(m==="select"&&this.op==="select")this.op="select"; return this; };});
  B.prototype.eq=function(k,v){this.f.push([k,v]);return this;};
  B.prototype.single=B.prototype.maybeSingle=function(){this.one=true;return this;};
  ["insert","update","upsert","delete"].forEach(function(m){B.prototype[m]=function(p){this.op=m;this.p=p;M.calls.push([m,this.t,p]);return this;};});
  B.prototype.then=function(res,rej){
    var rows=(db[this.t]||[]).filter(function(r){return this.f.every(function(f){return r[f[0]]===f[1];});},this);
    if(this.op==="insert"){ var row=Object.assign({id:"new"+Math.random(),code:"DDP-0099",created_at:new Date().toISOString()},this.p); (db[this.t]=db[this.t]||[]).unshift(row); rows=[row]; }
    var data=this.one?(rows[0]||null):rows;
    return Promise.resolve({data:data,error:null}).then(res,rej);
  };
  var session=M.session===undefined?{user:{id:uid,email:"y@x.ma",user_metadata:{}}}:M.session;
  window.supabase={createClient:function(){return {
    from:function(t){return new B(t);},
    rpc:function(n,a){M.calls.push(["rpc",n,a]);if(M.rpcError&&M.rpcError[n])return Promise.resolve({data:null,error:{message:M.rpcError[n]}});return Promise.resolve({data:n==="staff_role"?(M.role||"admin"):n==="account_exists"?!!M.exists:(M.rpcData&&M.rpcData[n])||null,error:null});},
    auth:{
      getSession:function(){return Promise.resolve({data:{session:session}});},
      onAuthStateChange:function(cb){M.authCb=cb;return {data:{subscription:{unsubscribe:function(){}}}};},
      signUp:function(o){M.calls.push(["signUp",o]);return Promise.resolve({data:{user:{id:M.newUserId||"u-new",identities:[{}],user_metadata:o.options.data},session:M.signUpSession?{user:{id:"u-new"}}:null},error:null});},
      signInWithPassword:function(o){var u={id:uid,email:o.email,user_metadata:{}};setTimeout(function(){M.authCb&&M.authCb("SIGNED_IN",{user:u});},0);return Promise.resolve({data:{user:u,session:{user:u}},error:null});},
      updateUser:function(o){M.calls.push(["updateUser",o]);return Promise.resolve({data:{user:{}},error:null});},
      signOut:function(){return Promise.resolve({});}
    },
    functions:{invoke:function(n,o){M.calls.push(["invoke",n,o&&o.body]);if(M.invokeError)return Promise.resolve({data:null,error:{message:"Edge Function returned a non-2xx status code",context:{json:function(){return Promise.resolve({error:M.invokeError});}}}});return Promise.resolve({data:M.invokeData||{ok:true,id:"c1",emailed:true},error:null});}},
    storage:{from:function(){return {upload:function(p){M.calls.push(["upload",p]);return Promise.resolve({data:{},error:null});},createSignedUrl:function(){return Promise.resolve({data:{signedUrl:"about:blank"},error:null});},createSignedUrls:function(ps){return Promise.resolve({data:ps.map(function(p){return {path:p,signedUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACw="};}),error:null});}};}}
  };}};
})();
