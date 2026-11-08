// AERO402 — front-end analysis application
// SECTION 1: APPROVED ENGINEERING MODEL (unchanged from Steps 1–4)
'use strict';
// Calculation API: angles in radians, pressure in Pa, length in m.
// Status is always VALID / WARNING / ERROR. Completion tracks availability
// separately, so warnings never accidentally block downstream calculations.
const AERO402 = (() => {
  const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI;
  const isFiniteNumber=v=>typeof v==='number'&&Number.isFinite(v);
  const SETTINGS=Object.freeze({thetaTolerance:1e-9,rootTolerance:1e-10,maxIterations:200,
    maxMach:100,divisionTolerance:1e-14,coefficientTolerance:1e-10,shockWarningMargin:rad(1)});
  const RANGES=Object.freeze({MInf:Object.freeze([1.5,5]),alpha:Object.freeze([rad(-10),rad(10)]),
    deltaL:Object.freeze([rad(2),rad(15)]),deltaT:Object.freeze([rad(2),rad(15)])});
  const IDS=['UF','UR','LF','LR'];
  const DEFAULT_INPUTS=Object.freeze({MInf:2.5,pInf:101325,alpha:rad(4),deltaL:rad(10),deltaT:rad(8),chord:1,gamma:1.4});
  const REFERENCE_TABLE=Object.freeze([
    [1.2,56.443,71.977,3.944,3.558,126.896],
    [1.5,41.810,66.589,12.113,11.905,118.549],
    [2,30.000,64.669,22.974,26.380,104.074],
    [2.5,23.578,64.782,29.797,39.124,91.331],
    [3,19.471,65.241,34.073,49.757,80.697],
    [4,14.478,66.059,38.774,65.785,64.669],
    [5,11.537,66.584,41.118,76.920,53.534]
  ].map(Object.freeze));
  function parameters(values) {
    return Object.fromEntries(Object.entries(values||{}).map(([k,v])=>[k,
      typeof v==='number'&&!isFiniteNumber(v)?String(v):v===undefined?'missing':v]));
  }
  function issue(severity,code,message,values={},context={}) {
    return {severity,code,message,parameters:parameters(values),...context};
  }
  const errorIssue=(code,message,values={},context={})=>issue('ERROR',code,message,values,context);
  const warningIssue=(code,message,values={},context={})=>issue('WARNING',code,message,values,context);
  function category(errors=[],warnings=[]) { return errors.length?'ERROR':warnings.length?'WARNING':'VALID'; }
  function assessment(errors=[],warnings=[],data={}) {
    return {...data,status:category(errors,warnings),errors,warnings,error:errors[0]||null};
  }
  function uniqueIssues(list) {
    const seen=new Set();return list.filter(item=>{const key=JSON.stringify(item);if(seen.has(key))return false;seen.add(key);return true;});
  }
  class ModelError extends Error {
    constructor(diagnostic){super(diagnostic.message);this.diagnostic=diagnostic;}
  }
  function fail(code,message,values={}) { throw new ModelError(errorIssue(code,message,values)); }
  function requireValue(condition,code,message,values={}) { if(!condition)fail(code,message,values); }
  function diagnostic(error,code='NUMERICAL_FAILURE',message='Numerical calculation failed.') {
    return error instanceof ModelError?error.diagnostic:errorIssue(code,message,{reason:String(error?.message||error)});
  }
  function requireAssessment(result) { if(result.status==='ERROR')throw new ModelError(result.errors[0]);return result; }
  function checked(value,label) {
    requireValue(isFiniteNumber(value),'NONPHYSICAL_RESULT',label+' is not finite.',{value});
    return value;
  }
  function safeDivide(numerator,denominator,{label='Division',epsilon=SETTINGS.divisionTolerance,code='NEAR_ZERO_DENOMINATOR'}={}) {
    requireValue(isFiniteNumber(numerator)&&isFiniteNumber(denominator),'NONFINITE_ARITHMETIC',label+' requires finite operands.',{numerator,denominator});
    requireValue(isFiniteNumber(epsilon)&&epsilon>0,'INVALID_NUMERICAL_CONTROL','Division tolerance must be finite and positive.');
    requireValue(Math.abs(denominator)>=epsilon,code,label+' is unavailable because its denominator is too close to zero.',{denominator,epsilon});
    return checked(numerator/denominator,label);
  }
  function validateInputs(inputs) {
    const errors=[],warnings=[];
    const labels={MInf:'Freestream Mach number',pInf:'Freestream static pressure',alpha:'Angle of attack',
      deltaL:'Leading-edge half-angle',deltaT:'Trailing-edge half-angle',chord:'Chord',gamma:'Specific-heat ratio'};
    for(const [field,label] of Object.entries(labels)) {
      const value=inputs?.[field];
      if(!isFiniteNumber(value))errors.push(errorIssue('NONFINITE_INPUT',label+' must be a finite number; missing values, NaN, and infinities are not accepted.',{field,value},{field}));
    }
    // Stage barriers: nonfinite -> physical -> supported ranges. Report all
    // independent issues within each stage without clamping any original value.
    if(errors.length)return assessment(errors,warnings,{stage:'finite'});
    const physical=[
      ['MInf',inputs.MInf>1,'INVALID_FREESTREAM_MACH','Freestream Mach number must be greater than 1 for supersonic shock–expansion analysis.'],
      ['pInf',inputs.pInf>0,'INVALID_PRESSURE','Freestream static pressure must be greater than zero.'],
      ['chord',inputs.chord>0,'INVALID_CHORD','Chord must be greater than zero.'],
      ['gamma',inputs.gamma>1,'INVALID_GAMMA','Specific-heat ratio γ must be greater than 1.'],
      ['deltaL',inputs.deltaL>0&&inputs.deltaL<Math.PI/2,'INVALID_GEOMETRY','Leading-edge half-angle must define a nondegenerate diamond panel (0° < δL < 90°).'],
      ['deltaT',inputs.deltaT>0&&inputs.deltaT<Math.PI/2,'INVALID_GEOMETRY','Trailing-edge half-angle must define a nondegenerate diamond panel (0° < δT < 90°).']
    ];
    physical.forEach(([field,ok,code,message])=>{if(!ok)errors.push(errorIssue(code,message,{field,value:inputs[field]},{field}));});
    if(errors.length)return assessment(errors,warnings,{stage:'physical'});
    const rangeMessages={MInf:'Input Mach number is outside the supported application range of 1.5–5.0.',
      alpha:'Angle of attack is outside the supported application range of −10° to +10°.',
      deltaL:'Leading-edge half-angle is outside the supported application range of 2°–15°.',
      deltaT:'Trailing-edge half-angle is outside the supported application range of 2°–15°.'};
    for(const [field,[min,max]] of Object.entries(RANGES))if(inputs[field]<min||inputs[field]>max)
      errors.push(errorIssue('OUTSIDE_SUPPORTED_RANGE',rangeMessages[field],{field,value:inputs[field],min,max,units:field==='MInf'?'dimensionless':'rad'},{field}));
    return assessment(errors,warnings,{stage:errors.length?'supported range':'complete'});
  }
  function validateGas(gamma) { requireValue(isFiniteNumber(gamma)&&gamma>1,'INVALID_GAMMA','Specific-heat ratio γ must be finite and greater than 1.',{gamma}); }
  function validateLocalSupersonic(M,p,gamma) {
    validateGas(gamma);
    requireValue(isFiniteNumber(M)&&M>1,'NON_SUPERSONIC_UPSTREAM','This nonzero turn requires a supersonic local upstream Mach number.',{M});
    requireValue(M<=SETTINGS.maxMach,'LOCAL_MACH_UNSUPPORTED','Local upstream Mach exceeds the existing numerical solver limit of 100.',{M});
    requireValue(isFiniteNumber(p)&&p>0,'INVALID_PRESSURE','Local static pressure must be finite and positive.',{p});
  }
  function validateFlowState(state) {
    const errors=[];
    for(const key of ['M','p','phi'])if(!isFiniteNumber(state?.[key]))
      errors.push(errorIssue('NONPHYSICAL_STATE','Local flow '+key+' must be finite.',{key,value:state?.[key]}));
    if(isFiniteNumber(state?.M)&&state.M<=0)errors.push(errorIssue('NONPHYSICAL_STATE','Local Mach number must be positive.',{M:state.M}));
    if(isFiniteNumber(state?.p)&&state.p<=0)errors.push(errorIssue('NONPHYSICAL_STATE','Local static pressure must be positive.',{p:state.p}));
    if(isFiniteNumber(state?.M)&&state.M>SETTINGS.maxMach)errors.push(errorIssue('LOCAL_MACH_UNSUPPORTED','Calculated Mach exceeds the existing numerical solver limit of 100.',{M:state.M}));
    return assessment(errors);
  }
  function createFlowState(M,p,phi,warnings=[]) {
    requireAssessment(validateFlowState({M,p,phi}));
    return {...assessment([],uniqueIssues(warnings)),available:true,M,p,phi};
  }
  function unavailableState(id,error,completion='unavailable') {
    return {...assessment([error]),id,available:false,completion,M:null,p:null,phi:null,Cp:null};
  }
  function buildGeometry({chord,deltaL,deltaT}) {
    requireValue(isFiniteNumber(chord)&&chord>0,'INVALID_CHORD','Chord must be finite and positive.',{chord});
    requireValue([deltaL,deltaT].every(v=>isFiniteNumber(v)&&v>0&&v<Math.PI/2),'INVALID_GEOMETRY','Both half-angles must lie strictly between 0° and 90°.');
    const tL=Math.tan(deltaL),tT=Math.tan(deltaT);
    // Same straight-panel intersection and outward normals as Step 2.
    const xMid=chord*safeDivide(tT,tL+tT,{label:'Panel intersection'}),height=xMid*tL;
    requireValue(isFiniteNumber(xMid)&&isFiniteNumber(height)&&xMid>0&&xMid<chord&&height>0,'INVALID_GEOMETRY','The panel intersection is degenerate or not representable.');
    const LE=[0,0],TE=[chord,0],U=[xMid,height],L=[xMid,-height];
    function panel(id,side,start,end,phi) {
      const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy),sign=side==='upper'?1:-1;
      requireValue(isFiniteNumber(length)&&length>0,'INVALID_GEOMETRY','Panel length is invalid.');
      return {id,side,start,end,phi,length,normal:[
        safeDivide(-sign*dy,length,{label:'Panel normal'}),safeDivide(sign*dx,length,{label:'Panel normal'})]};
    }
    return {chord,xMid,height,vertices:{LE,U,TE,L},panels:{
      UF:panel('UF','upper',LE,U,deltaL),UR:panel('UR','upper',U,TE,-deltaT),
      LF:panel('LF','lower',LE,L,-deltaL),LR:panel('LR','lower',L,TE,deltaT)}};
  }
  function machAngle(M) {
    requireValue(isFiniteNumber(M)&&M>1,'NON_SUPERSONIC_UPSTREAM','Mach angle requires a finite local Mach number greater than 1.',{M});
    return checked(Math.asin(safeDivide(1,M,{label:'Mach angle'})),'Mach angle');
  }
  function thetaFromBeta(beta,M,gamma) {
    validateGas(gamma);
    requireValue(isFiniteNumber(beta)&&isFiniteNumber(M)&&M>1,'INVALID_SHOCK_INPUT','Shock angle and supersonic upstream Mach must be finite.');
    // Established theta-beta-M relation; RHS is tan(theta).
    const ratio=safeDivide(M*M*Math.sin(beta)**2-1,M*M*(gamma+Math.cos(2*beta))+2,{label:'Theta-beta-M ratio'});
    return checked(Math.atan(safeDivide(2,Math.tan(beta),{label:'Cotangent of shock angle'})*ratio),'Shock deflection');
  }
  function bisect(fn,lo,hi,target,code,controls=SETTINGS) {
    const evaluate=x=>{const value=fn(x)-target;requireValue(isFiniteNumber(value),code,'Root solver produced a nonfinite residual.',{x});return value;};
    requireValue([lo,hi,target].every(isFiniteNumber)&&lo<hi,code,'Root solver bounds are invalid.');
    const fLo=evaluate(lo),fHi=evaluate(hi);
    requireValue(fLo<=0&&fHi>=0,code,'A root could not be bracketed.',{lo,hi,target,fLo,fHi});
    if(Math.abs(fLo)<=controls.rootTolerance)return lo;
    if(Math.abs(fHi)<=controls.rootTolerance)return hi;
    for(let i=0;i<controls.maxIterations;i++) {
      const mid=(lo+hi)/2,fMid=evaluate(mid);
      if(Math.abs(fMid)<=controls.rootTolerance)return mid;
      if(fMid<0)lo=mid;else hi=mid;
    }
    fail(code,'The numerical root solver did not converge within the finite iteration limit.',{maxIterations:controls.maxIterations,target});
  }
  function findThetaMax(M,gamma,controls=SETTINGS) {
    try {
      validateLocalSupersonic(M,1,gamma);
      const mu=machAngle(M),gold=(Math.sqrt(5)-1)/2;
      let lo=mu,hi=Math.PI/2,c=hi-gold*(hi-lo),d=lo+gold*(hi-lo);
      let fc=thetaFromBeta(c,M,gamma),fd=thetaFromBeta(d,M,gamma),converged=false;
      for(let i=0;i<controls.maxIterations;i++) {
        if(hi-lo<=controls.rootTolerance){converged=true;break;}
        if(fc>fd){hi=d;d=c;fd=fc;c=hi-gold*(hi-lo);fc=thetaFromBeta(c,M,gamma);}
        else{lo=c;c=d;fc=fd;d=lo+gold*(hi-lo);fd=thetaFromBeta(d,M,gamma);}
      }
      requireValue(converged,'THETA_MAX_CALCULATION_FAILURE','Maximum attached-shock deflection search did not converge.',{M,gamma,maxIterations:controls.maxIterations});
      const beta=(lo+hi)/2,thetaMax=thetaFromBeta(beta,M,gamma);
      requireValue(isFiniteNumber(thetaMax)&&thetaMax>0&&beta>mu&&beta<Math.PI/2,'THETA_MAX_CALCULATION_FAILURE','The calculated attached-shock maximum is invalid.',{M,gamma});
      return {...assessment(),mu,beta,thetaMax,theta:thetaMax};
    } catch(error) {return {...assessment([diagnostic(error,'THETA_MAX_CALCULATION_FAILURE')]),mu:null,beta:null,thetaMax:null,theta:null};}
  }
  const maximumAttachedShock=findThetaMax;
  function checkAttachedShock(M1,theta,gamma,controls=SETTINGS) {
    try {
      requireValue(isFiniteNumber(theta)&&theta>0,'INVALID_COMPRESSION','A compression turn must be finite and positive.',{theta});
      const limit=findThetaMax(M1,gamma,controls);requireAssessment(limit);
      const margin=limit.thetaMax-theta,values={M1,gamma,theta,thetaMax:limit.thetaMax,margin,betaAtMax:limit.beta};
      if(theta>limit.thetaMax)return {...assessment([errorIssue('NO_ATTACHED_SHOCK_SOLUTION',
        'No attached shock solution. The required compression turn exceeds the maximum attached-shock turning angle for the local upstream Mach number and specific-heat ratio.',values)]),...values,limit};
      const warnings=margin<=SETTINGS.shockWarningMargin?[warningIssue('NEAR_ATTACHED_SHOCK_LIMIT',
        'Compression turn is close to the maximum attached-shock limit (within 1°).',values)]:[];
      // At equality the weak/strong branches coalesce; accept the limiting
      // attached root with WARNING. Any positive excess remains an ERROR.
      return {...assessment([],warnings),...values,limit};
    } catch(error){return {...assessment([diagnostic(error,'THETA_MAX_CALCULATION_FAILURE')]),limit:null};}
  }
  function prandtlMeyer(M,gamma) {
    validateGas(gamma);
    requireValue(isFiniteNumber(M)&&M>=1,'INVALID_EXPANSION','Prandtl–Meyer requires a finite Mach number ≥ 1.',{M});
    const a=safeDivide(gamma+1,gamma-1,{label:'Prandtl–Meyer gas ratio'});
    const b=safeDivide(gamma-1,gamma+1,{label:'Prandtl–Meyer gas ratio'});
    return checked(Math.sqrt(a)*Math.atan(Math.sqrt(b*(M*M-1)))-Math.atan(Math.sqrt(M*M-1)),'Prandtl–Meyer angle');
  }
  function prandtlMeyerMaximum(gamma) {
    validateGas(gamma);
    return checked(Math.PI/2*(Math.sqrt(safeDivide(gamma+1,gamma-1,{label:'Prandtl–Meyer maximum'}))-1),'Prandtl–Meyer maximum');
  }
  function checkExpansionLimit(M1,theta,gamma) {
    let nu1=null,nuTarget=null,nuMax=null;
    try {
      validateLocalSupersonic(M1,1,gamma);
      requireValue(isFiniteNumber(theta)&&theta>0,'INVALID_EXPANSION','Expansion turn must be finite and positive.',{theta});
      nu1=prandtlMeyer(M1,gamma);nuTarget=checked(nu1+theta,'Target Prandtl–Meyer angle');nuMax=prandtlMeyerMaximum(gamma);
      requireValue(nuTarget<nuMax,'EXPANSION_LIMIT_EXCEEDED',
        'Invalid expansion / expansion limit exceeded. The target Prandtl–Meyer angle must be strictly below its theoretical maximum for a finite downstream Mach number.',{M1,gamma,theta,nu1,nuTarget,nuMax});
      return {...assessment(),nu1,nuTarget,nuMax,remaining:nuMax-nuTarget};
    }catch(error){return {...assessment([diagnostic(error)]),nu1,nuTarget,nuMax,remaining:null};}
  }
  function invertPrandtlMeyer(target,gamma,controls=SETTINGS) {
    const theoreticalMax=prandtlMeyerMaximum(gamma);
    requireValue(isFiniteNumber(target)&&target>=0&&target<theoreticalMax,'EXPANSION_LIMIT_EXCEEDED',
      'Invalid expansion / expansion limit exceeded: target must be below the theoretical Prandtl–Meyer maximum.',{target,theoreticalMax});
    const numericalMax=prandtlMeyer(SETTINGS.maxMach,gamma);
    requireValue(target<=numericalMax,'PM_INVERSION_FAILURE',
      'Prandtl–Meyer inversion failed. The target is below the theoretical limit, but requires a downstream Mach number beyond the existing numerical solver limit of 100.',{target,theoreticalMax,numericalMax,maxMach:SETTINGS.maxMach});
    return bisect(M=>prandtlMeyer(M,gamma),1,SETTINGS.maxMach,target,'PM_INVERSION_FAILURE',controls);
  }
  function validateShockResult(s,{M1,p1,theta,gamma,limit}) {
    const errors=[];
    if(!s||!['M2','p2','pressureRatio','beta'].every(k=>isFiniteNumber(s[k])))
      errors.push(errorIssue('INVALID_SHOCK_RESULT','Oblique-shock solver returned a nonfinite or missing result.'));
    else {
      if(!(s.M2>0&&s.p2>p1&&s.p2>0&&s.pressureRatio>1))errors.push(errorIssue('INVALID_SHOCK_RESULT','A genuine compression shock must have positive Mach and p₂ > p₁ > 0.',{M1,p1,M2:s.M2,p2:s.p2,pressureRatio:s.pressureRatio}));
      if(!(s.beta>limit.mu&&s.beta<=limit.beta&&s.beta<Math.PI/2))
        errors.push(errorIssue('WRONG_SHOCK_BRANCH','Returned shock angle is outside the weak attached-shock branch.',{beta:s.beta,mu:limit.mu,betaAtMax:limit.beta}));
      if(Math.abs(thetaFromBeta(s.beta,M1,gamma)-theta)>SETTINGS.rootTolerance*2)
        errors.push(errorIssue('SHOCK_SOLVER_FAILURE','Returned shock angle does not satisfy the required deflection tolerance.'));
    }
    if(s&&isFiniteNumber(s.M2)&&isFiniteNumber(s.p2))errors.push(...validateFlowState({M:s.M2,p:s.p2,phi:0}).errors);
    return assessment(errors);
  }
  function validateExpansionResult(s,{M1,p1}) {
    const errors=[];
    if(!s||!['M2','p2','pressureRatio','nu1','nu2'].every(k=>isFiniteNumber(s[k])))
      errors.push(errorIssue('INVALID_EXPANSION_RESULT','Prandtl–Meyer solver returned a nonfinite or missing result.'));
    else if(!(s.M2>M1&&s.p2>0&&s.p2<p1&&s.pressureRatio>0&&s.pressureRatio<1&&s.nu2>s.nu1))
      errors.push(errorIssue('INVALID_EXPANSION_RESULT','An expansion requires M₂ > M₁ and 0 < p₂ < p₁.',{M1,M2:s.M2,p1,p2:s.p2,pressureRatio:s.pressureRatio}));
    if(s&&isFiniteNumber(s.M2)&&isFiniteNumber(s.p2))errors.push(...validateFlowState({M:s.M2,p:s.p2,phi:0}).errors);
    return assessment(errors);
  }
  function obliqueShock(M1,p1,theta,gamma,controls=SETTINGS) {
    let attached=null,warnings=[];
    try {
      validateLocalSupersonic(M1,p1,gamma);
      attached=checkAttachedShock(M1,theta,gamma,controls);
      requireAssessment(attached);warnings=[...attached.warnings];
      // No root solve occurs unless the local attached-shock check permits it.
      const limit=attached.limit;
      const beta=bisect(b=>thetaFromBeta(b,M1,gamma),limit.mu,limit.beta,theta,'SHOCK_SOLVER_FAILURE',controls);
      const Mn1=M1*Math.sin(beta),Mn1sq=Mn1*Mn1;
      const Mn2sq=safeDivide(1+(gamma-1)/2*Mn1sq,gamma*Mn1sq-(gamma-1)/2,{label:'Normal-shock Mach relation'});
      requireValue(Mn2sq>0,'INVALID_SHOCK_RESULT','Normal-shock downstream Mach squared is not positive.');
      const M2=safeDivide(Math.sqrt(Mn2sq),Math.sin(beta-theta),{label:'Oblique-shock downstream Mach'});
      const pressureRatio=checked(1+safeDivide(2*gamma,gamma+1,{label:'Shock pressure ratio'})*(Mn1sq-1),'Shock pressure ratio');
      const p2=checked(p1*pressureRatio,'Post-shock pressure'),solved={M2,p2,beta,pressureRatio};
      requireAssessment(validateShockResult(solved,{M1,p1,theta,gamma,limit}));
      if(M2<=1)warnings.push(warningIssue('SUBSONIC_DOWNSTREAM','The attached shock produces M₂ ≤ 1. The shock state is physical, but a subsequent nonzero turn cannot use the supported supersonic wave model.',{M1,M2}));
      return {...assessment([],warnings),...solved,thetaMax:limit.thetaMax,limit};
    }catch(error){return {...assessment([diagnostic(error,'SHOCK_SOLVER_FAILURE')],warnings),M2:null,p2:null,beta:null,pressureRatio:null,thetaMax:attached?.thetaMax??null,limit:attached?.limit??null};}
  }
  function expansionFan(M1,p1,theta,gamma,controls=SETTINGS) {
    let limit=null;
    try {
      validateLocalSupersonic(M1,p1,gamma);
      limit=checkExpansionLimit(M1,theta,gamma);requireAssessment(limit);
      const nu1=limit.nu1,nu2=limit.nuTarget,M2=invertPrandtlMeyer(nu2,gamma,controls);
      const base=safeDivide(1+(gamma-1)/2*M1*M1,1+(gamma-1)/2*M2*M2,{label:'Isentropic pressure ratio'});
      const pressureRatio=checked(Math.pow(base,safeDivide(gamma,gamma-1,{label:'Isentropic exponent'})),'Expansion pressure ratio');
      const p2=checked(p1*pressureRatio,'Post-expansion pressure'),solved={M2,p2,pressureRatio,nu1,nu2};
      requireAssessment(validateExpansionResult(solved,{M1,p1}));
      requireValue(Math.abs(prandtlMeyer(M2,gamma)-nu2)<=SETTINGS.rootTolerance*2,'PM_INVERSION_FAILURE','Prandtl–Meyer inversion failed its final residual check.');
      return {...assessment(),...solved,limit};
    }catch(error){return {...assessment([diagnostic(error,'PM_INVERSION_FAILURE')]),M2:null,p2:null,pressureRatio:null,nu1:limit?.nu1??null,nu2:null,limit};}
  }
  function classifyTurn(phiUpstream,phiPanel,surface,epsilon=SETTINGS.thetaTolerance) {
    requireValue(surface==='upper'||surface==='lower','INVALID_SURFACE','Surface must be upper or lower.');
    requireValue([phiUpstream,phiPanel,epsilon].every(isFiniteNumber)&&epsilon>0,'INVALID_TURN','Invalid direction or angular tolerance.');
    const deltaPhi=phiPanel-phiUpstream,theta=Math.abs(deltaPhi);
    if(theta<epsilon)return {classification:'none',type:'none',deltaPhi,theta};
    const compression=surface==='upper'?deltaPhi>0:deltaPhi<0;
    return {classification:compression?'compression':'expansion',type:compression?'oblique shock':'Prandtl–Meyer expansion',deltaPhi,theta};
  }
  function emptyWave(panel,corner,error,completion='blocked') {
    return {...assessment(error?[error]:[]),status:'ERROR',completion,available:false,panel:panel.id,corner,surface:panel.side,
      type:null,classification:null,deltaPhi:null,theta:null,M1:null,M2:null,p1:null,p2:null,pressureRatio:null,
      beta:null,nu1:null,nu2:null,phi1:null,phi2:null,targetPhi:panel.phi,upstream:null,downstream:null,limit:null};
  }
  function calculateWave(upstream,panel,gamma,corner) {
    if(!upstream||upstream.status==='ERROR'||upstream.available===false)
      return emptyWave(panel,corner,upstream?.error||errorIssue('INVALID_UPSTREAM','Upstream flow state is unavailable.'));
    let wave=emptyWave(panel,corner,null,'failed');
    try {
      requireAssessment(validateFlowState(upstream));
      const turn=classifyTurn(upstream.phi,panel.phi,panel.side);
      wave={...wave,...turn,M1:upstream.M,p1:upstream.p,phi1:upstream.phi,upstream:{...upstream}};
      const solved=turn.classification==='none'?{...assessment(),M2:upstream.M,p2:upstream.p,pressureRatio:1}
        :turn.classification==='compression'?obliqueShock(upstream.M,upstream.p,turn.theta,gamma)
        :expansionFan(upstream.M,upstream.p,turn.theta,gamma);
      Object.assign(wave,solved);
      // WARNING is explicitly allowed through this barrier.
      if(solved.status==='ERROR')return wave;
      const contextual=solved.warnings.map(w=>({...w,panel:panel.id,surface:panel.side,corner}));
      wave.warnings=uniqueIssues([...(upstream.warnings||[]),...contextual]);
      wave.status=category([],wave.warnings);wave.completion='complete';wave.available=true;wave.phi2=panel.phi;
      wave.downstream=createFlowState(solved.M2,solved.p2,panel.phi,wave.warnings);
      return wave;
    }catch(error){
      const err=diagnostic(error);
      return {...wave,...assessment([err],wave.warnings),completion:'failed',available:false,M2:null,p2:null,pressureRatio:null,beta:null,nu2:null,phi2:null,downstream:null};
    }
  }
  function calculateCp(p,pInf,qInf) {
    requireValue([p,pInf,qInf].every(isFiniteNumber)&&p>0&&pInf>0&&qInf>0,'INVALID_CP','Cp requires finite positive static and dynamic pressures.');
    return safeDivide(p-pInf,qInf,{label:'Pressure coefficient'});
  }
  function calculateSurface(surface,freestream,geometry,gamma,qInf) {
    const ids=surface==='upper'?['UF','UR']:['LF','LR'],states={},waves={},errors=[],warnings=[];
    let upstream=freestream,originalError=null;
    ids.forEach((id,index)=>{
      const panel=geometry.panels[id],corner=index===0?'leading edge':'mid-corner';
      if(originalError){states[id]=unavailableState(id,originalError,'blocked');waves[id]=emptyWave(panel,corner,originalError);return;}
      const wave=calculateWave(upstream,panel,gamma,corner);waves[id]=wave;warnings.push(...wave.warnings);
      if(wave.status!=='ERROR'){
        try {
          states[id]={...wave.downstream,id,Cp:calculateCp(wave.p2,freestream.p,qInf),completion:'complete'};
          upstream=states[id];return;
        }catch(error){wave.errors=[diagnostic(error)];wave.error=wave.errors[0];wave.status='ERROR';wave.completion='failed';}
      }
      originalError={...wave.error,surface,panel:id,corner};wave.error=originalError;wave.errors=[originalError];
      states[id]=unavailableState(id,originalError);errors.push(originalError);
    });
    return {...assessment(errors,uniqueIssues(warnings)),completion:originalError?'failed':'complete',states,waves};
  }
  function calculateUpperSurface(f,g,gamma,q){return calculateSurface('upper',f,g,gamma,q);}
  function calculateLowerSurface(f,g,gamma,q){return calculateSurface('lower',f,g,gamma,q);}
  function unavailableForces(reason,errors=[]) {
    return {...assessment(errors),status:'ERROR',available:false,reason,Fx:null,Fy:null,L:null,D:null,CL:null,CD:null,CA:null,CN:null,LD:null,panelForces:null};
  }
  function calculateForces(states,geometry,freestream,qInf) {
    const dependencyErrors=IDS.flatMap(id=>states[id].errors||[]);
    if(!IDS.every(id=>states[id].status!=='ERROR'&&states[id].available&&isFiniteNumber(states[id].Cp)))
      return unavailableForces('All four valid panel pressures are required.',uniqueIssues(dependencyErrors));
    try {
      const warnings=uniqueIssues(IDS.flatMap(id=>states[id].warnings||[])),panelForces={};let Fx=0,Fy=0;
      for(const id of IDS){
        const p=geometry.panels[id],factor=-(states[id].p-freestream.p)*p.length;
        const vector=p.normal.map(n=>checked(factor*n,'Panel force'));panelForces[id]=vector;Fx+=vector[0];Fy+=vector[1];
      }
      const phi=freestream.phi,D=checked(Fx*Math.cos(phi)+Fy*Math.sin(phi),'Drag'),L=checked(-Fx*Math.sin(phi)+Fy*Math.cos(phi),'Lift');
      const reference=checked(qInf*geometry.chord,'Force reference');
      requireValue(reference>0,'INVALID_FORCE_REFERENCE','Force reference must be positive.');
      const values={Fx:checked(Fx,'Axial force'),Fy:checked(Fy,'Normal force'),L,D,
        CL:safeDivide(L,reference,{label:'CL'}),CD:safeDivide(D,reference,{label:'CD'}),
        CA:safeDivide(Fx,reference,{label:'CA'}),CN:safeDivide(Fy,reference,{label:'CN'})};
      let LD=null;
      if(Math.abs(values.CD)<SETTINGS.coefficientTolerance)warnings.push(warningIssue('NEAR_ZERO_DRAG','L/D is undefined because |CD| < 10⁻¹⁰.',{CD:values.CD,epsilon:SETTINGS.coefficientTolerance}));
      else LD=safeDivide(values.CL,values.CD,{label:'Lift-to-drag ratio',epsilon:SETTINGS.coefficientTolerance});
      return {...assessment([],uniqueIssues(warnings)),available:true,...values,LD,panelForces};
    }catch(error){const err=diagnostic(error);return unavailableForces(err.message,[err]);}
  }
  function calculateDiamondWedgeFlow(inputs) {
    const validation=validateInputs(inputs);
    const r={inputs:{...inputs},settings:{...SETTINGS},supportedRanges:RANGES,inputValidation:validation,geometry:null,freestream:null,qInf:null,
      upperSurface:null,lowerSurface:null,UF:null,UR:null,LF:null,LR:null,waves:{},pressureCoefficients:{},
      ...assessment([...validation.errors],[...validation.warnings]),completion:'failed',forces:unavailableForces('Input validation incomplete.')};
    try {
      requireAssessment(validation);
      r.geometry=buildGeometry(inputs);
      r.freestream=createFlowState(inputs.MInf,inputs.pInf,-inputs.alpha);
      r.qInf=checked(.5*inputs.gamma*inputs.pInf*inputs.MInf**2,'Freestream dynamic pressure');
      requireValue(r.qInf>0,'INVALID_DYNAMIC_PRESSURE','Freestream dynamic pressure is zero or unrepresentable.');
      safeDivide(1,r.qInf,{label:'Dynamic-pressure reference'});
    }catch(error){
      if(!r.errors.length)r.errors.push(diagnostic(error));
      const err=r.errors[0];r.status='ERROR';r.error=err;
      for(const id of IDS){
        r[id]=unavailableState(id,err);r.pressureCoefficients[id]=null;
        r.waves[id]=emptyWave({id,side:id[0]==='U'?'upper':'lower',phi:r.geometry?.panels[id].phi??null},id[1]==='F'?'leading edge':'mid-corner',err);
      }
      for(const side of ['upper','lower']){
        const ids=IDS.filter(id=>id[0]===(side==='upper'?'U':'L'));
        r[side+'Surface']={...assessment(r.errors),completion:'blocked',states:Object.fromEntries(ids.map(id=>[id,r[id]])),waves:Object.fromEntries(ids.map(id=>[id,r.waves[id]]))};
      }
      r.forces=unavailableForces(err.message,r.errors);return r;
    }
    r.upperSurface=calculateUpperSurface(r.freestream,r.geometry,inputs.gamma,r.qInf);
    r.lowerSurface=calculateLowerSurface(r.freestream,r.geometry,inputs.gamma,r.qInf);
    for(const s of [r.upperSurface,r.lowerSurface]){
      Object.assign(r,s.states);Object.assign(r.waves,s.waves);r.errors.push(...s.errors);r.warnings.push(...s.warnings);
    }
    for(const id of IDS)r.pressureCoefficients[id]=r[id].Cp;
    r.forces=calculateForces(r,r.geometry,r.freestream,r.qInf);
    r.errors=uniqueIssues([...r.errors,...r.forces.errors]);r.warnings=uniqueIssues([...r.warnings,...r.forces.warnings]);
    r.status=category(r.errors,r.warnings);r.error=r.errors[0]||null;
    r.completion=r.errors.length?(IDS.some(id=>r[id].available)?'partial':'failed'):'complete';
    return r;
  }
  function testZeroAlphaSymmetry(inputs={...DEFAULT_INPUTS,alpha:0,deltaT:DEFAULT_INPUTS.deltaL}){
    const result=calculateDiamondWedgeFlow({...inputs,alpha:0}),checks=[];
    const check=(name,passed)=>checks.push({name,passed:!!passed});
    const near=(a,b)=>isFiniteNumber(a)&&isFiniteNumber(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
    check('Symmetric case completes',result.status!=='ERROR');
    for(const id of ['UF','LF'])check(id+': leading-edge compression shock',result.waves[id].type==='oblique shock'&&result.waves[id].status!=='ERROR');
    for(const id of ['UR','LR'])check(id+': mid-corner expansion',result.waves[id].type==='Prandtl–Meyer expansion'&&result.waves[id].status!=='ERROR');
    for(const [u,l] of [['UF','LF'],['UR','LR']])for(const property of ['M','p','Cp'])check(property+': '+u+' = '+l,near(result[u][property],result[l][property]));
    check('CL approximately zero',result.forces.available&&near(result.forces.CL,0));
    return {passed:checks.every(c=>c.passed),checks,result};
  }
  function runSelfTests(){
    const checks=[...testZeroAlphaSymmetry().checks],run=o=>calculateDiamondWedgeFlow({...DEFAULT_INPUTS,...o});
    const near=(a,b,t=1e-8)=>isFiniteNumber(a)&&isFiniteNumber(b)&&Math.abs(a-b)<=t*Math.max(1,Math.abs(a),Math.abs(b));
    function test(name,fn){try{checks.push({name,passed:!!fn()});}catch(error){checks.push({name,passed:false,error:error.message});}}
    for(const row of REFERENCE_TABLE){
      const [M,mu,beta,theta,nu,remaining]=row;
      test('Team reference values at M = '+M,()=>{
        const limit=findThetaMax(M,1.4),v=prandtlMeyer(M,1.4),max=prandtlMeyerMaximum(1.4);
        return limit.status==='VALID'&&[[deg(limit.mu),mu],[deg(limit.beta),beta],[deg(limit.thetaMax),theta],[deg(v),nu],[deg(max-v),remaining]].every(([a,b])=>Math.abs(a-b)<.000501);
      });
    }
    test('Theoretical Prandtl–Meyer maximum agrees with 130.454°',()=>Math.abs(deg(prandtlMeyerMaximum(1.4))-130.454)<.000501);
    for(const [field,[min,max]] of Object.entries(RANGES)){
      for(const [label,value] of [['minimum',min],['maximum',max]])test(field+' '+label+' accepted by input validator',()=>validateInputs({...DEFAULT_INPUTS,[field]:value}).status==='VALID');
      for(const value of [min-1e-6,max+1e-6])test(field+' outside boundary rejected without clamping',()=>{
        const r=run({[field]:value});return r.status==='ERROR'&&r.geometry===null&&r.inputs[field]===value&&r.errors.some(e=>e.code==='OUTSIDE_SUPPORTED_RANGE'&&e.field===field);
      });
    }
    for(const field of Object.keys(DEFAULT_INPUTS))for(const value of [undefined,NaN,Infinity,-Infinity])
      test(field+': '+String(value)+' rejected specifically',()=>{const r=run({[field]:value});return r.status==='ERROR'&&r.errors.some(e=>e.code==='NONFINITE_INPUT'&&e.field===field)&&r.UF.M===null;});
    for(const [field,value] of [['MInf',1],['MInf',0],['pInf',0],['pInf',-1],['chord',0],['chord',-1],['gamma',1],['gamma',0],['deltaL',0],['deltaT',Math.PI/2]])
      test('Physical rejection of '+field+' = '+value,()=>{const r=run({[field]:value});return r.status==='ERROR'&&r.inputValidation.stage==='physical';});
    test('Multiple invalid inputs preserve distinct diagnostics',()=>validateInputs({...DEFAULT_INPUTS,MInf:NaN,pInf:Infinity}).errors.length===2);
    test('Default gamma is 1.4; other gamma > 1 is not silently replaced',()=>{const r=run({gamma:1.3});return DEFAULT_INPUTS.gamma===1.4&&r.status!=='ERROR'&&r.inputs.gamma===1.3;});
    for(const [id,center] of [['UF',-rad(5)],['LF',rad(5)]])test(id+': automatic expansion / none / compression transition',()=>{
      const types=[-1,0,1].map(sign=>run({deltaL:rad(5),alpha:center+sign*rad(.1)}).waves[id].classification);
      return JSON.stringify(types)===JSON.stringify(id==='UF'?['expansion','none','compression']:['compression','none','expansion']);
    });
    test('Zero turn copies upstream M and p exactly',()=>{const r=run({alpha:rad(10)});return r.waves.LF.type==='none'&&r.LF.M===r.freestream.M&&r.LF.p===r.freestream.p&&r.LF.Cp===0;});
    test('Negligible turn skips wave solvers',()=>classifyTurn(0,SETTINGS.thetaTolerance/2,'upper').type==='none');
    test('Zero-turn tolerance boundary is a genuine turn',()=>classifyTurn(0,SETTINGS.thetaTolerance,'upper').type==='oblique shock');
    test('Sequential front-to-rear state handoff',()=>{const r=run({});return ['UR','LR'].every(id=>{const front=id==='UR'?r.UF:r.LF,w=r.waves[id];return w.M1===front.M&&w.p1===front.p&&w.phi1===front.phi;});});
    test('Sign convention remains phiInf = −alpha',()=>run({alpha:rad(5)}).freestream.phi===-rad(5));
    test('Unequal-angle geometry follows both panel orientations',()=>Object.values(buildGeometry(DEFAULT_INPUTS).panels).every(p=>near(Math.atan2(p.end[1]-p.start[1],p.end[0]-p.start[0]),p.phi)));
    test('Outward normals close on the diamond',()=>{const sum=[0,0];Object.values(buildGeometry(DEFAULT_INPUTS).panels).forEach(p=>p.normal.forEach((n,i)=>sum[i]+=n*p.length));return sum.every(v=>Math.abs(v)<1e-12);});
    test('Warning continues through rear state and aerodynamic forces',()=>{
      const r=run({MInf:1.5,alpha:0,deltaL:rad(11.2)});
      return r.status==='WARNING'&&r.completion==='complete'&&r.UF.status==='WARNING'&&r.UR.available&&r.UR.status==='WARNING'&&r.forces.available&&r.warnings.some(w=>w.code==='NEAR_ATTACHED_SHOCK_LIMIT');
    });
    test('One-degree shock warning threshold',()=>{const l=findThetaMax(2,1.4);return checkAttachedShock(2,l.thetaMax-rad(.999),1.4).status==='WARNING'&&checkAttachedShock(2,l.thetaMax-rad(1.001),1.4).status==='VALID';});
    test('At maximum: limiting attached root warns; any excess errors',()=>{const l=findThetaMax(2,1.4);return obliqueShock(2,101325,l.thetaMax,1.4).status==='WARNING'&&checkAttachedShock(2,l.thetaMax+1e-12,1.4).error.code==='NO_ATTACHED_SHOCK_SOLUTION';});
    for(const [alpha,bad,good] of [[10,'upper','lower'],[-10,'lower','upper']])test('In-range detached shock on '+bad+' blocks only dependent states',()=>{
      const r=run({MInf:1.5,alpha:rad(alpha),deltaL:rad(5)}),f=bad==='upper'?'UF':'LF',rear=bad==='upper'?'UR':'LR';
      return r.inputValidation.status==='VALID'&&r.status==='ERROR'&&r[good+'Surface'].completion==='complete'&&r.waves[f].error.code==='NO_ATTACHED_SHOCK_SOLUTION'&&r.waves[f].beta===null&&r.waves[rear].completion==='blocked'&&r.waves[rear].M1===null&&r[rear].M===null&&r.waves[rear].error===r.waves[f].error&&r.forces.CL===null&&r.forces.CD===null&&r.forces.LD===null;
    });
    test('Local upstream Mach controls shock limit',()=>{
      const w=calculateWave(createFlowState(1.5,101325,0),{id:'UR',side:'upper',phi:rad(15)},1.4,'test');
      return w.status==='ERROR'&&w.error.code==='NO_ATTACHED_SHOCK_SOLUTION'&&w.error.parameters.M1===1.5;
    });
    test('Subsonic downstream shock stops a subsequent expansion',()=>{
      const r=run({MInf:1.5,alpha:0,deltaL:findThetaMax(1.5,1.4).thetaMax-1e-7});
      return r.UF.available&&r.UF.M<1&&r.UR.status==='ERROR'&&r.waves.UR.error.code==='NON_SUPERSONIC_UPSTREAM'&&!r.forces.available;
    });
    test('Both surfaces fail while retaining four wave records',()=>{const r=run({MInf:1.5,alpha:0,deltaL:rad(15)});return r.status==='ERROR'&&Object.keys(r.waves).length===4&&r.UR.completion==='blocked'&&r.LR.completion==='blocked'&&r.errors.length===2;});
    test('Compression residual and strict pressure rise',()=>{
      const s=obliqueShock(2,101325,rad(10),1.4);return s.status==='VALID'&&s.p2>101325&&s.beta<findThetaMax(2,1.4).beta&&Math.abs(thetaFromBeta(s.beta,2,1.4)-rad(10))<=SETTINGS.rootTolerance;
    });
    test('Expansion pressure and inversion residual',()=>{
      const s=expansionFan(2,101325,rad(12),1.4);return s.status==='VALID'&&s.M2>2&&s.p2>0&&s.p2<101325&&Math.abs(prandtlMeyer(s.M2,1.4)-s.nu2)<=SETTINGS.rootTolerance&&near(s.pressureRatio,Math.pow(1.8/(1+.2*s.M2*s.M2),3.5));
    });
    test('Exact theoretical PM limit and excess are errors',()=>{
      const max=prandtlMeyerMaximum(1.4),v=prandtlMeyer(2,1.4);
      return [max-v,max-v+.01].every(t=>checkExpansionLimit(2,t,1.4).error?.code==='EXPANSION_LIMIT_EXCEEDED');
    });
    test('Below theoretical limit but beyond Mach-100 bracket is numerical failure',()=>{
      const max=prandtlMeyerMaximum(1.4),v=prandtlMeyer(2,1.4),theta=(max+prandtlMeyer(100,1.4))/2-v;
      return checkExpansionLimit(2,theta,1.4).status==='VALID'&&expansionFan(2,101325,theta,1.4).error.code==='PM_INVERSION_FAILURE';
    });
    test('THETA_MAX_CALCULATION_FAILURE on forced nonconvergence',()=>findThetaMax(2,1.4,{...SETTINGS,maxIterations:1}).error.code==='THETA_MAX_CALCULATION_FAILURE');
    test('PM_INVERSION_FAILURE on forced nonconvergence',()=>expansionFan(2,101325,rad(10),1.4,{...SETTINGS,maxIterations:1}).error.code==='PM_INVERSION_FAILURE');
    test('SHOCK_SOLVER_FAILURE on forced nonconvergence',()=>{
      const l=findThetaMax(2,1.4);try{bisect(b=>thetaFromBeta(b,2,1.4),l.mu,l.beta,rad(10),'SHOCK_SOLVER_FAILURE',{...SETTINGS,maxIterations:1});return false;}catch(e){return diagnostic(e).code==='SHOCK_SOLVER_FAILURE';}
    });
    const shockContext={M1:2,p1:101325,theta:rad(10),gamma:1.4,limit:findThetaMax(2,1.4)};
    test('Shock sanity checker rejects reversed pressure',()=>validateShockResult({...obliqueShock(2,101325,rad(10),1.4),p2:100000},shockContext).status==='ERROR');
    test('Shock sanity checker rejects strong branch',()=>validateShockResult({...obliqueShock(2,101325,rad(10),1.4),beta:rad(85)},shockContext).errors.some(e=>e.code==='WRONG_SHOCK_BRANCH'));
    test('Expansion sanity checker rejects nonincreasing Mach',()=>validateExpansionResult({...expansionFan(2,101325,rad(10),1.4),M2:2},{M1:2,p1:101325}).status==='ERROR');
    test('Flow-state validation rejects invalid output values',()=>[NaN,Infinity,-1,0].every(p=>validateFlowState({M:2,p,phi:0}).status==='ERROR'));
    test('safeDivide rejects near-zero denominators',()=>{try{safeDivide(1,1e-16);return false;}catch(e){return diagnostic(e).code==='NEAR_ZERO_DENOMINATOR';}});
    test('Near-zero drag yields warning and null L/D',()=>{
      const g=buildGeometry(DEFAULT_INPUTS),f=createFlowState(2,101325,0),states={};
      IDS.forEach(id=>states[id]={...f,Cp:0});
      const r=calculateForces(states,g,f,283710);return r.status==='WARNING'&&r.LD===null&&r.CL===0&&r.CD===0;
    });
    test('Extremely small pressure fails explicitly',()=>run({pInf:1e-300}).status==='ERROR');
    test('Overflowing dynamic pressure fails explicitly',()=>run({pInf:Number.MAX_VALUE}).status==='ERROR');
    test('All result categories are VALID, WARNING, or ERROR',()=>{
      function walk(v){if(!v||typeof v!=='object')return true;if('status'in v&&!['VALID','WARNING','ERROR'].includes(v.status))return false;return Object.values(v).every(walk);}
      return [run({}),run({MInf:1.5,alpha:0,deltaL:rad(11.2)}),run({MInf:1.5,deltaL:rad(15)})].every(walk);
    });
    test('All warnings and errors have severity, code, message, parameters',()=>{
      const r=run({MInf:1.5,alpha:0,deltaL:rad(12)});
      return [...r.errors,...r.warnings].every(e=>['WARNING','ERROR'].includes(e.severity)&&e.code&&e.message&&e.parameters);
    });
    test('Finite outputs or null across success and physical failures',()=>{
      function finiteTree(v){return typeof v==='number'?isFiniteNumber(v):v&&typeof v==='object'?Object.values(v).every(finiteTree):true;}
      return [run({}),run({MInf:1.5,deltaL:rad(15)}),run({MInf:5,alpha:rad(-10)})].every(finiteTree);
    });
    test('Mirror incidence preserves drag and reverses lift',()=>{
      const a=run({alpha:rad(4)}),b=run({alpha:rad(-4)});return a.status!=='ERROR'&&b.status!=='ERROR'&&near(a.UF.p,b.LF.p)&&near(a.UR.p,b.LR.p)&&near(a.forces.CL,-b.forces.CL)&&near(a.forces.CD,b.forces.CD);
    });
    return {passed:checks.every(c=>c.passed),total:checks.length,passedCount:checks.filter(c=>c.passed).length,checks};
  }
  return Object.freeze({SETTINGS,RANGES,DEFAULT_INPUTS,REFERENCE_TABLE,IDS,rad,deg,validateInputs,isFiniteNumber,machAngle,thetaFromBeta,findThetaMax,
    checkAttachedShock,prandtlMeyerMaximum,checkExpansionLimit,validateFlowState,validateShockResult,validateExpansionResult,safeDivide,
    buildGeometry,createFlowState,classifyTurn,calculateWave,calculateUpperSurface,calculateLowerSurface,calculateCp,calculateDiamondWedgeFlow,
    testZeroAlphaSymmetry,runSelfTests,obliqueShock,expansionFan,prandtlMeyer,invertPrandtlMeyer,maximumAttachedShock,calculateForces});
})();
globalThis.AERO402=AERO402;

// SECTION 2: PRESENTATION DATA AND VIEW CHECKS
'use strict';
// Presentation data only: all physical states come from the established engine.
const AERO402_VIEW=(()=>{
  function pressureDistribution(result){
    if(!result?.geometry)return {segments:[],missing:AERO402.IDS.slice(),complete:false,xMid:null};
    const {geometry}=result,segments=[],missing=[];
    for(const id of AERO402.IDS){
      const state=result[id],panel=geometry.panels[id];
      if(!state.available||state.status==='ERROR'||!Number.isFinite(state.Cp)){missing.push(id);continue;}
      segments.push({id,surface:panel.side,x0:panel.start[0]/geometry.chord,x1:panel.end[0]/geometry.chord,
        Cp:state.Cp,p:state.p,M:state.M,status:state.status});
    }
    return {segments,missing,complete:missing.length===0,xMid:geometry.xMid/geometry.chord};
  }
  function waveDirections(wave,side){
    if(!wave||wave.status==='ERROR'||!wave.available||wave.type==='none')return [];
    const sign=side==='upper'?1:-1;
    if(wave.classification==='compression')return [wave.phi1+sign*wave.beta];
    const initial=wave.phi1+sign*Math.asin(1/wave.M1),final=wave.phi2+sign*Math.asin(1/wave.M2);
    return Array.from({length:7},(_,i)=>initial+(final-initial)*i/6);
  }
  function boundaryChecks(){
    const {rad,DEFAULT_INPUTS:d,calculateDiamondWedgeFlow:run}=AERO402;
    const cases=[
      ['B01','M∞ = 1','ERROR · INVALID_FREESTREAM_MACH',{MInf:1},r=>r.status==='ERROR'&&r.errors[0].code==='INVALID_FREESTREAM_MACH'],
      ['B02','p∞ = 0 Pa','ERROR · INVALID_PRESSURE',{pInf:0},r=>r.status==='ERROR'&&r.errors[0].code==='INVALID_PRESSURE'],
      ['B03','γ = 1','ERROR · INVALID_GAMMA',{gamma:1},r=>r.status==='ERROR'&&r.errors[0].code==='INVALID_GAMMA'],
      ['B04','M∞ = 1.2','ERROR · OUTSIDE_SUPPORTED_RANGE',{MInf:1.2},r=>r.status==='ERROR'&&r.errors[0].code==='OUTSIDE_SUPPORTED_RANGE'],
      ['B05','M∞ = 1.5; α = 0°; δL = 15°','ERROR · NO_ATTACHED_SHOCK_SOLUTION',{MInf:1.5,alpha:0,deltaL:rad(15)},r=>r.status==='ERROR'&&r.waves.UF.error.code==='NO_ATTACHED_SHOCK_SOLUTION'],
      ['B06','α = 5°; δL = 5°','VALID · LF: NO WAVE',{alpha:rad(5),deltaL:rad(5)},r=>r.status==='VALID'&&r.waves.LF.type==='none'],
      ['B07','M∞ = 1.5; α = 0°; δL = 11.2°','WARNING · calculations continue',{MInf:1.5,alpha:0,deltaL:rad(11.2)},r=>r.status==='WARNING'&&r.UR.available&&r.forces.available]
    ].map(([id,label,expected,overrides,check])=>{
      const result=run({...d,...overrides});
      return {id,label,expected,actual:result.status+(result.errors[0]?' · '+result.errors[0].code:result.waves.LF.type==='none'?' · LF: NO WAVE':result.warnings[0]?' · '+result.warnings[0].code:''),passed:check(result)};
    });
    const theta=AERO402.prandtlMeyerMaximum(1.4)-AERO402.prandtlMeyer(2,1.4);
    const expansion=AERO402.expansionFan(2,101325,theta,1.4);
    cases.push({id:'B08',label:'Solver: M₁ = 2; νtarget = νmax',expected:'ERROR · EXPANSION_LIMIT_EXCEEDED',
      actual:expansion.status+' · '+expansion.error?.code,passed:expansion.status==='ERROR'&&expansion.error?.code==='EXPANSION_LIMIT_EXCEEDED'});
    return cases;
  }
  function runTests(){
    const checks=[],run=o=>AERO402.calculateDiamondWedgeFlow({...AERO402.DEFAULT_INPUTS,...o});
    function test(name,fn){try{checks.push({name,passed:!!fn()});}catch(e){checks.push({name,passed:false,error:e.message});}}
    test('Plot has four piecewise-constant panel segments',()=>{const r=run({}),p=pressureDistribution(r);return p.complete&&p.segments.length===4&&p.segments.every(s=>s.Cp===r[s.id].Cp);});
    test('Plot uses actual x/c intersection for unequal angles',()=>{const r=run({}),p=pressureDistribution(r);return p.xMid!==.5&&p.segments.filter(s=>s.id[1]==='F').every(s=>s.x0===0&&s.x1===p.xMid)&&p.segments.filter(s=>s.id[1]==='R').every(s=>s.x0===p.xMid&&s.x1===1);});
    test('Unavailable panels are absent from the pressure plot',()=>{const r=run({MInf:1.5,alpha:AERO402.rad(10),deltaL:AERO402.rad(5)}),p=pressureDistribution(r);return !p.complete&&p.segments.length===2&&p.missing.join(',')==='UF,UR';});
    test('Invalid input clears plot data',()=>pressureDistribution(run({MInf:1})).segments.length===0);
    test('Shock rays use upstream flow angle and local beta',()=>{const r=run({});return waveDirections(r.waves.UF,'upper')[0]===r.waves.UF.phi1+r.waves.UF.beta&&waveDirections(r.waves.LF,'lower')[0]===r.waves.LF.phi1-r.waves.LF.beta;});
    test('Expansion fan uses initial and final Mach angles',()=>{const r=run({}),w=r.waves.UR,rays=waveDirections(w,'upper');return rays.length===7&&Math.abs(rays[0]-w.phi1-Math.asin(1/w.M1))<1e-12&&Math.abs(rays[6]-w.phi2-Math.asin(1/w.M2))<1e-12;});
    test('No-wave corner has no drawn wave ray',()=>waveDirections(run({alpha:AERO402.rad(10)}).waves.LF,'lower').length===0);
    test('Error corner has no drawn wave ray',()=>waveDirections(run({MInf:1.5,deltaL:AERO402.rad(15)}).waves.UF,'upper').length===0);
    return {passed:checks.every(c=>c.passed),total:checks.length,passedCount:checks.filter(c=>c.passed).length,checks};
  }
  return Object.freeze({pressureDistribution,waveDirections,boundaryChecks,runTests});
})();
globalThis.AERO402_VIEW=AERO402_VIEW;

// SECTION 3: INTERFACE, FORMATTING, SVG AND EVENTS
'use strict';
const $=id=>document.getElementById(id),{rad,deg,IDS}=AERO402;
const fmt=(v,n=4)=>typeof v==='number'&&Number.isFinite(v)?(v!==0&&(Math.abs(v)<.5*10**(-n)||Math.abs(v)>=1e8)?v.toExponential(3):v.toFixed(n)):'—';
const angle=v=>v===null||v===undefined?'—':fmt(deg(v),3);
const pressure=v=>v===null||v===undefined?'—':fmt(v,2);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={UF:'Upper Front',UR:'Upper Rear',LF:'Lower Front',LR:'Lower Rear'};
const fields={MInf:'mach',pInf:'pinf',alpha:'alpha',gamma:'gamma',deltaL:'dl',deltaT:'dt',chord:'chord'};
// UI demonstration inputs are defined in index.html. The model's existing
// DEFAULT_INPUTS remains the fixed regression-test baseline.
const coefficient=v=>Number.isFinite(v)?(Math.abs(v)<0.00005?'0.0000':v.toFixed(4)):'Unavailable';
const locations={UF:'Upper leading edge',UR:'Upper mid-corner',LF:'Lower leading edge',LR:'Lower mid-corner'};
function updateModelDetails(){
  const gamma=Number($('gamma').value);
  $('currentGamma').textContent=$('gamma').value.trim()!==''&&Number.isFinite(gamma)&&gamma>1?gamma.toFixed(4):'Invalid input';
  $('rootTolerance').textContent=AERO402.SETTINGS.rootTolerance.toExponential(0)+' rad';
  $('maxIterations').textContent=String(AERO402.SETTINGS.maxIterations);
}
let selectedPanel='UF';
function badge(status,label=status){return '<span class="status '+status+'">'+escapeHTML(label)+'</span>';}
function readInputs(){
  const number=id=>$(id).value.trim()===''?NaN:Number($(id).value);
  return {MInf:number('mach'),pInf:number('pinf'),alpha:rad(number('alpha')),gamma:number('gamma'),deltaL:rad(number('dl')),deltaT:rad(number('dt')),chord:number('chord')};
}
function waveName(w){return w.type==='none'?'None':w.type||'Unavailable';}
function svgText(x,y,value,color='#9db0c9',size=14,extra=''){
  return '<text x="'+x+'" y="'+y+'" fill="'+color+'" font-size="'+size+'" '+extra+'>'+escapeHTML(value)+'</text>';
}
function svgLine(a,b,color,width=1.5,extra=''){
  return '<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+b[0]+'" y2="'+b[1]+'" stroke="'+color+'" stroke-width="'+width+'" '+extra+'/>';
}
function directionEnd(origin,phi,length){return [origin[0]+length*Math.cos(phi),origin[1]-length*Math.sin(phi)];}
function arc(origin,r,start,end,color){
  if(Math.abs(end-start)<AERO402.SETTINGS.thetaTolerance)return '';
  const a=directionEnd(origin,start,r),b=directionEnd(origin,end,r);
  return '<path d="M '+a.join(' ')+' A '+r+' '+r+' 0 '+(Math.abs(end-start)>Math.PI?1:0)+' '+(end>start?0:1)+' '+b.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="1.5"/>';
}
function svgPanelGroup(id,content,label){
  return '<g data-panel="'+id+'" role="button" tabindex="0" aria-label="'+escapeHTML(label)+'"><title>'+escapeHTML(label)+'</title>'+content+'</g>';
}
function renderDiagram(result){
  const svg=$('diagram'),g=result.geometry;
  if(!g){svg.innerHTML=svgText(550,325,'Geometry unavailable — check the input diagnostics.','#9db0c9',18,'text-anchor="middle"');return;}
  // Normalize by chord first to keep this display independent of dimensional scale.
  const scale=640,origin=[260,325],point=([x,y])=>[origin[0]+x/g.chord*scale,origin[1]-y/g.chord*scale];
  let markup='<defs><marker id="flowArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7Z" fill="#9db0c9"/></marker></defs>';
  markup+=svgLine([225,325],[985,325],'#365275',1,'stroke-dasharray="5 5"');
  for(const id of IDS){
    const w=result.waves[id],p=g.panels[id],start=point(p.start),color=w.classification==='compression'?'#5eead4':'#fdba74';
    const rays=AERO402_VIEW.waveDirections(w,p.side);
    if(rays.length)markup+=svgPanelGroup(id,rays.map(phi=>svgLine(start,directionEnd(start,phi,270),color,w.classification==='compression'?2.5:1.2,w.classification==='expansion'?'stroke-dasharray="4 3"':'')).join(''),id+': '+waveName(w));
  }
  markup+='<polygon points="'+['LE','U','TE','L'].map(v=>point(g.vertices[v]).join(',')).join(' ')+'" fill="#1b3554" stroke="#dbeafe" stroke-width="2"/>';
  markup+=svgLine(point(g.vertices.LE),point(g.vertices.TE),'#9db0c9',1,'stroke-dasharray="5 5"');
  markup+=svgText(530,319,'Chord line','#9db0c9',11);
  for(const id of IDS){
    const p=g.panels[id],s=result[id],a=point(p.start),b=point(p.end),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const panelLine=svgLine(a,b,id===selectedPanel?'#5eead4':'#c7d7ed',id===selectedPanel?4:2.5);
    const hit=svgLine(a,b,'transparent',20);
    const label=svgText(mid[0]+p.normal[0]*17,mid[1]-p.normal[1]*17,id,'#e8f0fb',13,'text-anchor="middle"');
    markup+=svgPanelGroup(id,hit+panelLine+label,'Inspect '+names[id]+': M '+fmt(s.M,3)+', p '+pressure(s.p)+' Pa, Cp '+fmt(s.Cp));
    if(s.available){
      const arrowStart=[mid[0]+p.normal[0]*37-22*Math.cos(p.phi),mid[1]-p.normal[1]*37+22*Math.sin(p.phi)];
      markup+=svgLine(arrowStart,directionEnd(arrowStart,p.phi,44),'#9db0c9',1.7,'marker-end="url(#flowArrow)"');
    }
  }
  if(result.freestream){
    const phi=result.freestream.phi,center=[100,325];
    markup+=svgLine(directionEnd(center,phi,-65),directionEnd(center,phi,65),'#9db0c9',2,'marker-end="url(#flowArrow)"');
    markup+=svgLine(center,[175,325],'#526780',1,'stroke-dasharray="3 4"');
    markup+=arc(center,48,0,phi,'#c7d7ed');
    markup+=svgText(22,245,'M∞ = '+fmt(result.freestream.M,3),'#c7d7ed',15);
    markup+=svgText(22,268,'α = '+angle(result.inputs.alpha)+'°','#c7d7ed',14);
    markup+=svgText(22,291,'φ∞ = '+angle(phi)+'°','#9db0c9',13);
  }
  const selected=result.waves[selectedPanel],sp=g.panels[selectedPanel];
  if(selected.available&&selected.type!=='none'){
    const start=point(sp.start),side=sp.side==='upper'?1:-1;
    markup+=svgLine(start,directionEnd(start,selected.phi1,98),'#9db0c9',1,'stroke-dasharray="3 4"');
    markup+=arc(start,28,selected.phi1,selected.phi2,'#e8f0fb');
    const thetaLabel=directionEnd(start,(selected.phi1+selected.phi2)/2,38);
    markup+=svgText(thetaLabel[0],thetaLabel[1]+4,'θ','#e8f0fb',12);
    if(selected.classification==='compression'){
      markup+=arc(start,58,selected.phi1,selected.phi1+side*selected.beta,'#5eead4');
      const betaLabel=directionEnd(start,selected.phi1+side*selected.beta/2,72);
      markup+=svgText(betaLabel[0],betaLabel[1]+4,'β','#5eead4',13);
    }
  }
  markup+=svgText(244,350,'LE','#9db0c9',12);
  markup+=svgText(912,346,'TE / +x','#9db0c9',12);
  markup+='<rect x="452" y="497" width="196" height="135" rx="10" fill="#0b1b2e" stroke="#263b59"/>';
  markup+=svgText(550,521,'Geometry','#e8f0fb',14,'text-anchor="middle"');
  markup+=svgText(550,547,'δL '+angle(result.inputs.deltaL)+'° · δT '+angle(result.inputs.deltaT)+'°','#c7d7ed',12,'text-anchor="middle"');
  markup+=svgText(550,574,'c = '+fmt(g.chord,3)+' m','#9db0c9',13,'text-anchor="middle"');
  markup+=svgText(550,601,'Mid x/c = '+fmt(g.xMid/g.chord,4),'#9db0c9',13,'text-anchor="middle"');
  // Wave callouts remain clear of the body and contain the required engineering labels.
  const boxes={UF:[18,18],UR:[662,18],LF:[18,497],LR:[662,497]};
  for(const id of IDS){
    const [x,y]=boxes[id],w=result.waves[id],s=result[id],color=w.status==='ERROR'?'#fda4af':w.classification==='expansion'?'#fdba74':'#5eead4';
    let box='<rect x="'+x+'" y="'+y+'" width="420" height="135" rx="10" fill="#0b1b2e" stroke="'+(id===selectedPanel?'#5eead4':'#365275')+'" stroke-width="'+(id===selectedPanel?2:1)+'"/>';
    box+=svgText(x+14,y+23,id+' · '+names[id]+' · '+w.status,'#e8f0fb',14);
    box+=svgText(x+14,y+46,waveName(w),color,14);
    if(w.available){
      box+=svgText(x+14,y+69,'M₁ '+fmt(w.M1,3)+' → M₂ '+fmt(w.M2,3)+'   ·   θ '+angle(w.theta)+'°','#c7d7ed',13);
      box+=svgText(x+14,y+92,w.classification==='compression'?'β '+angle(w.beta)+'° (from upstream flow)':w.classification==='expansion'?'ν₁ '+angle(w.nu1)+'° → ν₂ '+angle(w.nu2)+'°':'Zero turn · upstream Mach and pressure unchanged','#c7d7ed',13);
      box+=svgText(x+14,y+115,'p '+pressure(s.p)+' Pa   ·   Cp '+fmt(s.Cp,5),'#9db0c9',13);
    }else{
      box+=svgText(x+14,y+72,w.completion==='blocked'?'Blocked by upstream error':'Unavailable — see diagnostics','#fda4af',13);
      box+=svgText(x+14,y+99,w.error?.code||'CALCULATION_UNAVAILABLE','#9db0c9',12);
    }
    markup+=svgPanelGroup(id,box,'Inspect '+names[id]+': '+waveName(w)+', '+w.status);
  }
  svg.innerHTML=markup;
}
function renderPressurePlot(result){
  const data=AERO402_VIEW.pressureDistribution(result),svg=$('pressurePlot');
  globalThis.lastPressureData=data;
  if(!data.segments.length){
    $('pressureCaption').textContent='Pressure distribution unavailable: no valid panel states.';
    svg.innerHTML=svgText(550,170,'No valid pressure data for this case.','#9db0c9',17,'text-anchor="middle"');return;
  }
  $('pressureCaption').textContent=(data.complete?(result.status==='WARNING'?'Complete distribution — warnings apply.':'Complete distribution.'):'Partial distribution — unavailable panels: '+data.missing.join(', ')+'.')+' Mid-corner at x/c = '+fmt(data.xMid,5)+'.';
  const values=[0,...data.segments.map(s=>s.Cp)],low=Math.min(...values),high=Math.max(...values),span=Math.max(high-low,.1),lo=low-span*.16,hi=high+span*.20;
  const x=v=>88+v*940,y=v=>270-(v-lo)/(hi-lo)*224;
  let markup=svgText(20,30,'Cp','#c7d7ed',15)+svgText(1028,322,'x/c','#c7d7ed',14,'text-anchor="end"');
  for(let i=0;i<=4;i++){
    const value=lo+(hi-lo)*i/4,Y=y(value);
    markup+=svgLine([88,Y],[1028,Y],'#263b59',1)+svgText(74,Y+4,fmt(value,3),'#9db0c9',12,'text-anchor="end"');
    const xv=i/4,X=x(xv);markup+=svgLine([X,46],[X,270],'#263b59',1)+svgText(X,294,fmt(xv,2),'#9db0c9',12,'text-anchor="middle"');
  }
  markup+=svgLine([88,y(0)],[1028,y(0)],'#526780',1,'stroke-dasharray="3 4"');
  markup+=svgLine([x(data.xMid),46],[x(data.xMid),270],'#526780',1,'stroke-dasharray="4 4"');
  for(const surface of ['upper','lower']){
    const segs=data.segments.filter(s=>s.surface===surface),color=surface==='upper'?'#5eead4':'#c4b5fd',dash=surface==='lower'?'stroke-dasharray="9 6"':'';
    if(segs.length===2)markup+=svgLine([x(segs[0].x1),y(segs[0].Cp)],[x(segs[1].x0),y(segs[1].Cp)],color,2,dash);
    for(const s of segs){
      const a=[x(s.x0),y(s.Cp)],b=[x(s.x1),y(s.Cp)],label=s.id+': Cp '+fmt(s.Cp,6)+'; p '+pressure(s.p)+' Pa; x/c '+fmt(s.x0,4)+' to '+fmt(s.x1,4);
      const line=svgLine(a,b,'transparent',18)+svgLine(a,b,color,s.id===selectedPanel?5:3.5,dash);
      const text=svgText((a[0]+b[0])/2,a[1]+(surface==='upper'?-10:19),s.id,color,12,'text-anchor="middle"');
      markup+=svgPanelGroup(s.id,line+text,label);
    }
  }
  markup+=svgLine([88,46],[88,270],'#9db0c9',1.2)+svgLine([88,270],[1028,270],'#9db0c9',1.2);
  svg.innerHTML=markup;
}
function renderInspector(result){
  IDS.forEach(id=>$('inspect-'+id).setAttribute('aria-pressed',String(id===selectedPanel)));
  const w=result.waves[selectedPanel],s=result[selectedPanel];
  const items=[['Wave',waveName(w)],['Classification',w.classification||'Unavailable'],['Turning angle θ',angle(w.theta)+'°'],
    ['M₁ → M₂',fmt(w.M1,5)+' → '+fmt(w.M2,5)],['p₁ → p₂ (Pa)',pressure(w.p1)+' → '+pressure(w.p2)],['p₂/p₁',fmt(w.pressureRatio,6)],
    ['φ₁ → φ₂',angle(w.phi1)+'° → '+angle(w.phi2)+'°'],['Panel Cp',fmt(s.Cp,6)]];
  if(w.classification==='compression')items.push(['Shock angle β',angle(w.beta)+'°']);
  if(w.classification==='expansion')items.push(['ν₁ → ν₂',angle(w.nu1)+'° → '+angle(w.nu2)+'°']);
  $('waveInspector').innerHTML='<h3>'+selectedPanel+' · '+names[selectedPanel]+' '+badge(w.status)+'</h3>'+(w.error?'<p class="reason">'+escapeHTML(w.error.message)+'</p>':'')+
    '<div class="inspect-grid">'+items.map(([label,value])=>'<dl><dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(value)+'</dd></dl>').join('')+'</div>';
}
function diagnosticHTML(item){
  const p=item.parameters||{},where=item.panel?locations[item.panel]+' ('+item.panel+')':item.field?item.field:'';
  let details='';
  if(p.thetaMax!==undefined)details='<br>Local M₁ = '+fmt(p.M1,4)+' · Required θ = '+angle(p.theta)+'° · θmax = '+angle(p.thetaMax)+'° · Margin = '+angle(p.margin)+'°';
  if(p.nuMax!==undefined)details+='<br>νtarget = '+angle(p.nuTarget)+'° · νmax = '+angle(p.nuMax)+'°';
  if(p.target!==undefined&&p.numericalMax!==undefined)details+='<br>νtarget = '+angle(p.target)+'° · Numerical maximum = '+angle(p.numericalMax)+'°';
  return '<div class="banner '+(item.severity==='ERROR'?'failed':'warning')+'"><strong>'+item.severity+(where?' · '+escapeHTML(where):'')+'</strong><br>'+escapeHTML(item.message)+details+'<br><span class="diagnostic-code">'+escapeHTML(item.code)+'</span></div>';
}
function resultCards(force,waiting=false){
  const entries=[['CN','Normal-force coefficient',force.CN],['CA','Axial-force coefficient',force.CA],['CL','Lift coefficient',force.CL],['CD','Wave-drag coefficient',force.CD],['L/D','Lift-to-drag ratio',force.LD]];
  return entries.map(([symbol,label,value])=>{
    const unavailable=value===null||value===undefined||!Number.isFinite(value);
    const text=waiting?'Awaiting update':unavailable?(symbol==='L/D'&&force.available?'Undefined':'Unavailable'):coefficient(value);
    return '<div class="metric"><span class="metric-symbol">'+symbol+'</span><span class="metric-label">'+label+'</span><b'+(waiting||unavailable?' class="unavailable"':'')+'>'+text+'</b></div>';
  }).join('');
}
function render(result){
  globalThis.lastResult=result;updateModelDetails();
  const f=result.forces;
  $('metrics').innerHTML=resultCards(f);
  const heading=result.status==='VALID'?'VALID · Valid solution — all four panel states were calculated successfully.'
    :result.status==='WARNING'?'WARNING · Calculation completed — review the engineering warnings below.'
    :'ERROR · '+(result.completion==='partial'?'Partial result — dependent calculations are unavailable.':'This case cannot be calculated.');
  const base='<div class="banner '+(result.status==='ERROR'?'failed':result.status==='WARNING'?'warning':'')+'"><strong>'+heading+'</strong><span class="note">Upper surface: '+result.upperSurface.status+' · Lower surface: '+result.lowerSurface.status+' · q∞ = '+pressure(result.qInf)+' Pa'+(f.available?'':' · '+escapeHTML(f.reason))+'</span></div>';
  $('diagnostics').innerHTML=base+result.errors.map(diagnosticHTML).join('')+result.warnings.map(diagnosticHTML).join('');
  Object.entries(fields).forEach(([field,id])=>$(id).setAttribute('aria-invalid',String(result.inputValidation.errors.some(e=>e.field===field))));
  $('inputFeedback').textContent='Results correspond to the current submitted inputs.';
  $('surfaces').innerHTML=['upper','lower'].map(side=>{
    const ids=side==='upper'?['UF','UR']:['LF','LR'];
    return '<section class="card"><h3>'+(side==='upper'?'Upper':'Lower')+' surface '+badge(result[side+'Surface'].status)+'</h3><p class="note">Freestream → '+ids[0]+' → '+ids[1]+'</p>'+ids.map(id=>{
      const w=result.waves[id],s=result[id];
      return '<div class="step"><strong>'+id+' · '+w.corner+'</strong> '+badge(w.status)+'<p>'+escapeHTML(waveName(w))+' · Δφ '+angle(w.deltaPhi)+'° · θ '+angle(w.theta)+'°</p><p>M '+fmt(w.M1,3)+' → '+fmt(w.M2,3)+'</p>'+(s.error?'<p class="reason">'+(s.completion==='blocked'?'Blocked by upstream error: ':'')+escapeHTML(s.error.message)+'</p>':s.warnings.length?'<p class="note">Warning retained; downstream calculation continues.</p>':'')+'</div>';
    }).join('')+'</section>';
  }).join('');
  $('panels').innerHTML=IDS.map(id=>{
    const s=result[id],w=result.waves[id];
    const values=s.available?[fmt(s.M,4),pressure(s.p),fmt(s.Cp,5),angle(s.phi)]:Array(4).fill('Unavailable');
    return '<tr><td><strong>'+id+'</strong><span class="cell-label">'+names[id]+'</span><div class="cell-status">'+badge(s.status)+'</div></td><td>'+escapeHTML(waveName(w))+(s.completion==='blocked'?'<span class="cell-label">Blocked by upstream error</span>':'')+'</td>'+values.map(v=>'<td class="numeric">'+v+'</td>').join('')+'</tr>';
  }).join('');
  $('waves').innerHTML=IDS.map(id=>{
    const w=result.waves[id],available=w.available&&w.status!=='ERROR';
    const value=(v,format)=>v===null||v===undefined?'Unavailable':format(v);
    const cells=[
      value(w.theta,angle),
      w.classification==='compression'?(available?angle(w.beta):'Unavailable'):'—',
      w.classification==='expansion'?(w.nu1===null?'Unavailable':angle(w.nu1)):'—',
      w.classification==='expansion'?(available?angle(w.nu2):'Unavailable'):'—',
      value(w.M1,v=>fmt(v,4)),available?fmt(w.M2,4):'Unavailable',
      value(w.p1,pressure),available?pressure(w.p2):'Unavailable',
      available?fmt(w.pressureRatio,6):'Unavailable'
    ];
    return '<tr><td>'+locations[id]+'<span class="cell-label">→ '+id+'</span><div class="cell-status">'+badge(w.status)+'</div></td><td>'+escapeHTML(waveName(w))+'</td>'+cells.map(v=>'<td class="numeric">'+v+'</td>').join('')+'</tr>';
  }).join('');
  renderDiagram(result);renderPressurePlot(result);renderInspector(result);
}
function run(){render(AERO402.calculateDiamondWedgeFlow(readInputs()));}
function inputsChanged(){
  const validation=AERO402.validateInputs(readInputs());updateModelDetails();
  Object.entries(fields).forEach(([field,id])=>$(id).setAttribute('aria-invalid',String(validation.errors.some(e=>e.field===field))));
  $('inputFeedback').textContent=validation.status==='ERROR'?validation.errors.map(e=>e.message).join(' '):'Inputs are within the supported range. Press Calculate / Update Analysis to check the local physical solution.';
  // Clear superseded outputs until the new inputs are explicitly submitted.
  globalThis.lastResult=null;globalThis.lastPressureData=null;
  $('metrics').innerHTML=resultCards({},true);
  $('diagnostics').innerHTML='<div class="banner pending-state">Inputs changed. Results have been cleared. Press Calculate / Update Analysis.</div>'+validation.errors.map(diagnosticHTML).join('');
  $('diagram').innerHTML=svgText(550,325,'Press Calculate / Update Analysis to refresh the diagram.','#9db0c9',18,'text-anchor="middle"');
  $('pressurePlot').innerHTML=svgText(550,170,'Awaiting recalculation.','#9db0c9',18,'text-anchor="middle"');
  $('pressureCaption').textContent='Pressure data cleared after input changes.';
  $('surfaces').innerHTML='';$('panels').innerHTML='';$('waves').innerHTML='';
  $('waveInspector').textContent='Select a panel after calculating the updated case.';
}
function selectPanel(id){
  if(!IDS.includes(id)||!globalThis.lastResult)return;
  selectedPanel=id;$('inspectorDetails').open=true;renderDiagram(globalThis.lastResult);renderPressurePlot(globalThis.lastResult);renderInspector(globalThis.lastResult);
}
function renderAcceptance(report){
  const ok=report.passed?'Automated checks pass':'Automated check failure — review required',checkState=report.passed?'CHECKED':'REVIEW';
  const rows=[
    ['AC-01','Front-end operation','Local index.html, style.css and app.js; no network-loaded assets or calculation service.','IMPLEMENTED'],
    ['AC-02','Required inputs','Mach, pressure in Pa, α, δL, δT, chord and γ; units and supported ranges shown.','IMPLEMENTED'],
    ['AC-03','Input validation',ok,checkState],
    ['AC-04','Oblique-shock calculation','Weak branch, normal-component relations, residual and reference-table tests.',checkState],
    ['AC-05','Attached-shock limit','Dynamic local-Mach maximum; detached-shock cases rejected.',checkState],
    ['AC-06','Expansion calculation','Numerical PM inversion, pressure relation and sanity checks.',checkState],
    ['AC-07','Expansion limit','Theoretical and numerical limits checked separately.',checkState],
    ['AC-08','Sequential calculation','Front-to-rear upstream handoff tests.',checkState],
    ['AC-09','Automatic classification','Both leading-edge transitions and zero-turn tolerance tests.',checkState],
    ['AC-10','Symmetry','Upper/lower M, p, Cp equality and CL approximately zero.',checkState],
    ['AC-11','Panel results','Named panels, wave type, M, pressure, Cp, flow direction and status.','IMPLEMENTED'],
    ['AC-12','Aerodynamic results','CL, CD, CA, CN and guarded L/D; unavailable after dependent failure.',checkState],
    ['AC-13','Wave visualization','Geometry, freestream, local arrows, ray directions, angle annotations, callouts and panel inspector. Browser visual sign-off pending.','IMPLEMENTED'],
    ['AC-14','Responsive updates','Calculate / Update Analysis refreshes results in place; edits clear superseded results.','IMPLEMENTED'],
    ['AC-15','Error handling','Original errors retained, dependent outputs null and no false pressure curves.',checkState],
    ['AC-16','Warning handling','Warnings survive front-to-rear calculations and preserve usable forces.',checkState],
    ['AC-17','Pressure distribution','Upper/lower piecewise Cp versus x/c using the actual geometry.',checkState],
    ['AC-18','Numerical reliability','10⁻¹⁰ angular residual, 200 iterations, explicit nonconvergence checks.',checkState],
    ['AC-19','Five independent representative cases','Pending the team’s five case inputs and independently calculated expected values; automated/reference-limit checks are not a substitute.','PENDING'],
    ['AC-20','Boundary validation','Eight named cases below, plus the embedded boundary and failure tests.',checkState],
    ['AC-21','Browser portability','Extract the complete project and open index.html. Manual verification in the team’s target browsers remains pending.','PENDING'],
    ['AC-22','Engineering traceability','Documented equations, signs, units, ranges and source-function mapping in app.js and README.md.','IMPLEMENTED']
  ];
  $('acceptanceRows').innerHTML=rows.map(([id,title,evidence,status])=>'<tr><td>'+id+' · '+title+'</td><td>'+escapeHTML(evidence)+'</td><td class="'+(status==='PENDING'?'pending':'')+'">'+status+'</td></tr>').join('');
  const boundary=AERO402_VIEW.boundaryChecks();globalThis.lastBoundaryReport=boundary;
  $('boundaryRows').innerHTML=boundary.map(b=>'<tr><td>'+b.id+'</td><td>'+escapeHTML(b.label)+'</td><td>'+escapeHTML(b.expected)+'</td><td>'+escapeHTML(b.actual)+'</td><td>'+ (b.passed?'PASS':'FAIL')+'</td></tr>').join('');
}
function runChecks(){
  const engine=AERO402.runSelfTests(),view=AERO402_VIEW.runTests(),checks=[...engine.checks,...view.checks];
  const report={passed:checks.every(c=>c.passed),total:checks.length,passedCount:checks.filter(c=>c.passed).length,checks};globalThis.lastTestReport=report;
  $('testSummary').textContent=report.passedCount+'/'+report.total+' passed'+(report.passed?'':' — engineering review required');
  $('testSummary').style.color=report.passed?'var(--cyan)':'var(--red)';
  $('testResults').innerHTML=report.checks.map(c=>'<li style="color:'+(c.passed?'var(--muted)':'var(--red)')+'">'+(c.passed?'PASS':'FAIL')+' · '+escapeHTML(c.name)+(c.error?' · '+escapeHTML(c.error):'')+'</li>').join('');
  renderAcceptance(report);
}
$('conditions').addEventListener('submit',event=>{event.preventDefault();run();});
$('conditions').addEventListener('input',inputsChanged);
$('test').addEventListener('click',runChecks);
IDS.forEach(id=>$('inspect-'+id).addEventListener('click',()=>selectPanel(id)));
for(const id of ['diagram','pressurePlot']){
  $(id).addEventListener('click',event=>{const target=event.target.closest('[data-panel]');if(target)selectPanel(target.getAttribute('data-panel'));});
  $(id).addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const target=event.target.closest('[data-panel]');
    if(target){event.preventDefault();const panel=target.getAttribute('data-panel');selectPanel(panel);$('inspect-'+panel).focus();}
  });
}
$('references').innerHTML=AERO402.REFERENCE_TABLE.map(row=>'<tr>'+row.map((v,i)=>'<td>'+fmt(v,i===0?1:3)+'</td>').join('')+'</tr>').join('');
run();runChecks();

