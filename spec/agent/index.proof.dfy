lemma NotNativeSpeechOrControl(r: Route)
  requires |r.path| >= 11
  requires !(r.path[5] == "a"[0] && r.path[6] == "l"[0] && r.path[10] == "-"[0])
  requires !(r.path[5] == "a"[0] && r.path[6] == "s"[0])
  ensures r !in nativeSpeechRoutes
  ensures r !in nativeControlRoutes
{
  assert nativeSpeechRoutes[0].path[5] == "a"[0] && nativeSpeechRoutes[0].path[6] == "l"[0] && nativeSpeechRoutes[0].path[10] == "-"[0];
  assert nativeSpeechRoutes[1].path[5] == "a"[0] && nativeSpeechRoutes[1].path[6] == "s"[0];
  assert nativeControlRoutes[0].path[5] == "a"[0] && nativeControlRoutes[0].path[6] == "l"[0] && nativeControlRoutes[0].path[10] == "-"[0];
  assert nativeControlRoutes[1].path[5] == "a"[0] && nativeControlRoutes[1].path[6] == "l"[0] && nativeControlRoutes[1].path[10] == "-"[0];
  assert nativeControlRoutes[2].path[5] == "a"[0] && nativeControlRoutes[2].path[6] == "l"[0] && nativeControlRoutes[2].path[10] == "-"[0];
  assert nativeControlRoutes[3].path[5] == "a"[0] && nativeControlRoutes[3].path[6] == "l"[0] && nativeControlRoutes[3].path[10] == "-"[0];
}

lemma CoreNotNativeA(i: int)
  requires 0 <= i < 15
  ensures pageRoutesCore[i] !in nativeSpeechRoutes
  ensures pageRoutesCore[i] !in nativeControlRoutes
{
  if i == 0 { NotNativeSpeechOrControl(pageRoutesCore[0]); } else if i == 1 { NotNativeSpeechOrControl(pageRoutesCore[1]); } else if i == 2 { NotNativeSpeechOrControl(pageRoutesCore[2]); } else if i == 3 { NotNativeSpeechOrControl(pageRoutesCore[3]); } else if i == 4 { NotNativeSpeechOrControl(pageRoutesCore[4]); }
  else if i == 5 { NotNativeSpeechOrControl(pageRoutesCore[5]); } else if i == 6 { NotNativeSpeechOrControl(pageRoutesCore[6]); } else if i == 7 { NotNativeSpeechOrControl(pageRoutesCore[7]); } else if i == 8 { NotNativeSpeechOrControl(pageRoutesCore[8]); } else if i == 9 { NotNativeSpeechOrControl(pageRoutesCore[9]); }
  else if i == 10 { NotNativeSpeechOrControl(pageRoutesCore[10]); } else if i == 11 { NotNativeSpeechOrControl(pageRoutesCore[11]); } else if i == 12 { NotNativeSpeechOrControl(pageRoutesCore[12]); } else if i == 13 { NotNativeSpeechOrControl(pageRoutesCore[13]); } else { NotNativeSpeechOrControl(pageRoutesCore[14]); }
}

lemma CoreNotNativeB(i: int)
  requires 15 <= i < 32
  ensures pageRoutesCore[i] !in nativeSpeechRoutes
  ensures pageRoutesCore[i] !in nativeControlRoutes
{
  if i == 15 { NotNativeSpeechOrControl(pageRoutesCore[15]); } else if i == 16 { NotNativeSpeechOrControl(pageRoutesCore[16]); } else if i == 17 { NotNativeSpeechOrControl(pageRoutesCore[17]); } else if i == 18 { NotNativeSpeechOrControl(pageRoutesCore[18]); } else if i == 19 { NotNativeSpeechOrControl(pageRoutesCore[19]); }
  else if i == 20 { NotNativeSpeechOrControl(pageRoutesCore[20]); } else if i == 21 { NotNativeSpeechOrControl(pageRoutesCore[21]); } else if i == 22 { NotNativeSpeechOrControl(pageRoutesCore[22]); } else if i == 23 { NotNativeSpeechOrControl(pageRoutesCore[23]); } else if i == 24 { NotNativeSpeechOrControl(pageRoutesCore[24]); }
  else if i == 25 { NotNativeSpeechOrControl(pageRoutesCore[25]); } else if i == 26 { NotNativeSpeechOrControl(pageRoutesCore[26]); } else if i == 27 { NotNativeSpeechOrControl(pageRoutesCore[27]); } else if i == 28 { NotNativeSpeechOrControl(pageRoutesCore[28]); } else if i == 29 { NotNativeSpeechOrControl(pageRoutesCore[29]); }
  else if i == 30 { NotNativeSpeechOrControl(pageRoutesCore[30]); } else { NotNativeSpeechOrControl(pageRoutesCore[31]); }
}

lemma CoreNotNative(route: Route)
  requires route in pageRoutesCore
  ensures route !in nativeSpeechRoutes
  ensures route !in nativeControlRoutes
{
  assert |pageRoutesCore| == 32;
  var i :| 0 <= i < 32 && pageRoutesCore[i] == route;
  if i < 15 { CoreNotNativeA(i); } else { CoreNotNativeB(i); }
}

lemma AppsNotNativeA(i: int)
  requires 0 <= i < 15
  ensures pageRoutesApps[i] !in nativeSpeechRoutes
  ensures pageRoutesApps[i] !in nativeControlRoutes
{
  if i == 0 { NotNativeSpeechOrControl(pageRoutesApps[0]); } else if i == 1 { NotNativeSpeechOrControl(pageRoutesApps[1]); } else if i == 2 { NotNativeSpeechOrControl(pageRoutesApps[2]); } else if i == 3 { NotNativeSpeechOrControl(pageRoutesApps[3]); } else if i == 4 { NotNativeSpeechOrControl(pageRoutesApps[4]); }
  else if i == 5 { NotNativeSpeechOrControl(pageRoutesApps[5]); } else if i == 6 { NotNativeSpeechOrControl(pageRoutesApps[6]); } else if i == 7 { NotNativeSpeechOrControl(pageRoutesApps[7]); } else if i == 8 { NotNativeSpeechOrControl(pageRoutesApps[8]); } else if i == 9 { NotNativeSpeechOrControl(pageRoutesApps[9]); }
  else if i == 10 { NotNativeSpeechOrControl(pageRoutesApps[10]); } else if i == 11 { NotNativeSpeechOrControl(pageRoutesApps[11]); } else if i == 12 { NotNativeSpeechOrControl(pageRoutesApps[12]); } else if i == 13 { NotNativeSpeechOrControl(pageRoutesApps[13]); } else { NotNativeSpeechOrControl(pageRoutesApps[14]); }
}

lemma AppsNotNativeB(i: int)
  requires 15 <= i < 31
  ensures pageRoutesApps[i] !in nativeSpeechRoutes
  ensures pageRoutesApps[i] !in nativeControlRoutes
{
  if i == 15 { NotNativeSpeechOrControl(pageRoutesApps[15]); } else if i == 16 { NotNativeSpeechOrControl(pageRoutesApps[16]); } else if i == 17 { NotNativeSpeechOrControl(pageRoutesApps[17]); } else if i == 18 { NotNativeSpeechOrControl(pageRoutesApps[18]); } else if i == 19 { NotNativeSpeechOrControl(pageRoutesApps[19]); }
  else if i == 20 { NotNativeSpeechOrControl(pageRoutesApps[20]); } else if i == 21 { NotNativeSpeechOrControl(pageRoutesApps[21]); } else if i == 22 { NotNativeSpeechOrControl(pageRoutesApps[22]); } else if i == 23 { NotNativeSpeechOrControl(pageRoutesApps[23]); } else if i == 24 { NotNativeSpeechOrControl(pageRoutesApps[24]); }
  else if i == 25 { NotNativeSpeechOrControl(pageRoutesApps[25]); } else if i == 26 { NotNativeSpeechOrControl(pageRoutesApps[26]); } else if i == 27 { NotNativeSpeechOrControl(pageRoutesApps[27]); } else if i == 28 { NotNativeSpeechOrControl(pageRoutesApps[28]); } else if i == 29 { NotNativeSpeechOrControl(pageRoutesApps[29]); }
  else { NotNativeSpeechOrControl(pageRoutesApps[30]); }
}

lemma AppsNotNative(route: Route)
  requires route in pageRoutesApps
  ensures route !in nativeSpeechRoutes
  ensures route !in nativeControlRoutes
{
  assert |pageRoutesApps| == 31;
  var i :| 0 <= i < 31 && pageRoutesApps[i] == route;
  if i < 15 { AppsNotNativeA(i); } else { AppsNotNativeB(i); }
}

lemma WorkflowsNotNativeA(i: int)
  requires 0 <= i < 10
  ensures pageRoutesWorkflows[i] !in nativeSpeechRoutes
  ensures pageRoutesWorkflows[i] !in nativeControlRoutes
{
  if i == 0 { NotNativeSpeechOrControl(pageRoutesWorkflows[0]); } else if i == 1 { NotNativeSpeechOrControl(pageRoutesWorkflows[1]); } else if i == 2 { NotNativeSpeechOrControl(pageRoutesWorkflows[2]); } else if i == 3 { NotNativeSpeechOrControl(pageRoutesWorkflows[3]); } else if i == 4 { NotNativeSpeechOrControl(pageRoutesWorkflows[4]); }
  else if i == 5 { NotNativeSpeechOrControl(pageRoutesWorkflows[5]); } else if i == 6 { NotNativeSpeechOrControl(pageRoutesWorkflows[6]); } else if i == 7 { NotNativeSpeechOrControl(pageRoutesWorkflows[7]); } else if i == 8 { NotNativeSpeechOrControl(pageRoutesWorkflows[8]); } else { NotNativeSpeechOrControl(pageRoutesWorkflows[9]); }
}

lemma WorkflowsNotNativeB(i: int)
  requires 10 <= i < 20
  ensures pageRoutesWorkflows[i] !in nativeSpeechRoutes
  ensures pageRoutesWorkflows[i] !in nativeControlRoutes
{
  if i == 10 { NotNativeSpeechOrControl(pageRoutesWorkflows[10]); } else if i == 11 { NotNativeSpeechOrControl(pageRoutesWorkflows[11]); } else if i == 12 { NotNativeSpeechOrControl(pageRoutesWorkflows[12]); } else if i == 13 { NotNativeSpeechOrControl(pageRoutesWorkflows[13]); } else if i == 14 { NotNativeSpeechOrControl(pageRoutesWorkflows[14]); }
  else if i == 15 { NotNativeSpeechOrControl(pageRoutesWorkflows[15]); } else if i == 16 { NotNativeSpeechOrControl(pageRoutesWorkflows[16]); } else if i == 17 { NotNativeSpeechOrControl(pageRoutesWorkflows[17]); } else if i == 18 { NotNativeSpeechOrControl(pageRoutesWorkflows[18]); } else { NotNativeSpeechOrControl(pageRoutesWorkflows[19]); }
}

lemma WorkflowsNotNativeC(i: int)
  requires 20 <= i < 30
  ensures pageRoutesWorkflows[i] !in nativeSpeechRoutes
  ensures pageRoutesWorkflows[i] !in nativeControlRoutes
{
}

lemma WorkflowsNotNative(route: Route)
  requires route in pageRoutesWorkflows
  ensures route !in nativeSpeechRoutes
  ensures route !in nativeControlRoutes
{
  assert |pageRoutesWorkflows| == 30;
  var i :| 0 <= i < 30 && pageRoutesWorkflows[i] == route;
  if i < 10 { WorkflowsNotNativeA(i); } else if i < 20 { WorkflowsNotNativeB(i); } else { WorkflowsNotNativeC(i); }
}

lemma TasksWalletNotNativeA(i: int)
  requires 0 <= i < 10
  ensures pageRoutesTasksWallet[i] !in nativeSpeechRoutes
  ensures pageRoutesTasksWallet[i] !in nativeControlRoutes
{
  if i == 0 { NotNativeSpeechOrControl(pageRoutesTasksWallet[0]); } else if i == 1 { NotNativeSpeechOrControl(pageRoutesTasksWallet[1]); } else if i == 2 { NotNativeSpeechOrControl(pageRoutesTasksWallet[2]); } else if i == 3 { NotNativeSpeechOrControl(pageRoutesTasksWallet[3]); } else if i == 4 { NotNativeSpeechOrControl(pageRoutesTasksWallet[4]); }
  else if i == 5 { NotNativeSpeechOrControl(pageRoutesTasksWallet[5]); } else if i == 6 { NotNativeSpeechOrControl(pageRoutesTasksWallet[6]); } else if i == 7 { NotNativeSpeechOrControl(pageRoutesTasksWallet[7]); } else if i == 8 { NotNativeSpeechOrControl(pageRoutesTasksWallet[8]); } else { NotNativeSpeechOrControl(pageRoutesTasksWallet[9]); }
}

lemma TasksWalletNotNativeB(i: int)
  requires 10 <= i < 20
  ensures pageRoutesTasksWallet[i] !in nativeSpeechRoutes
  ensures pageRoutesTasksWallet[i] !in nativeControlRoutes
{
  if i == 10 { NotNativeSpeechOrControl(pageRoutesTasksWallet[10]); } else if i == 11 { NotNativeSpeechOrControl(pageRoutesTasksWallet[11]); } else if i == 12 { NotNativeSpeechOrControl(pageRoutesTasksWallet[12]); } else if i == 13 { NotNativeSpeechOrControl(pageRoutesTasksWallet[13]); } else if i == 14 { NotNativeSpeechOrControl(pageRoutesTasksWallet[14]); }
  else if i == 15 { NotNativeSpeechOrControl(pageRoutesTasksWallet[15]); } else if i == 16 { NotNativeSpeechOrControl(pageRoutesTasksWallet[16]); } else if i == 17 { NotNativeSpeechOrControl(pageRoutesTasksWallet[17]); } else if i == 18 { NotNativeSpeechOrControl(pageRoutesTasksWallet[18]); } else { NotNativeSpeechOrControl(pageRoutesTasksWallet[19]); }
}

lemma TasksWalletNotNativeC(i: int)
  requires 20 <= i < 30
  ensures pageRoutesTasksWallet[i] !in nativeSpeechRoutes
  ensures pageRoutesTasksWallet[i] !in nativeControlRoutes
{
  if i == 20 { NotNativeSpeechOrControl(pageRoutesTasksWallet[20]); } else if i == 21 { NotNativeSpeechOrControl(pageRoutesTasksWallet[21]); } else if i == 22 { NotNativeSpeechOrControl(pageRoutesTasksWallet[22]); } else if i == 23 { NotNativeSpeechOrControl(pageRoutesTasksWallet[23]); } else if i == 24 { NotNativeSpeechOrControl(pageRoutesTasksWallet[24]); }
  else if i == 25 { NotNativeSpeechOrControl(pageRoutesTasksWallet[25]); } else if i == 26 { NotNativeSpeechOrControl(pageRoutesTasksWallet[26]); } else if i == 27 { NotNativeSpeechOrControl(pageRoutesTasksWallet[27]); } else if i == 28 { NotNativeSpeechOrControl(pageRoutesTasksWallet[28]); } else { NotNativeSpeechOrControl(pageRoutesTasksWallet[29]); }
}

lemma TasksWalletNotNativeD(i: int)
  requires 30 <= i < 38
  ensures pageRoutesTasksWallet[i] !in nativeSpeechRoutes
  ensures pageRoutesTasksWallet[i] !in nativeControlRoutes
{
  if i == 30 { NotNativeSpeechOrControl(pageRoutesTasksWallet[30]); } else if i == 31 { NotNativeSpeechOrControl(pageRoutesTasksWallet[31]); } else if i == 32 { NotNativeSpeechOrControl(pageRoutesTasksWallet[32]); } else if i == 33 { NotNativeSpeechOrControl(pageRoutesTasksWallet[33]); }
  else if i == 34 { NotNativeSpeechOrControl(pageRoutesTasksWallet[34]); } else if i == 35 { NotNativeSpeechOrControl(pageRoutesTasksWallet[35]); } else if i == 36 { NotNativeSpeechOrControl(pageRoutesTasksWallet[36]); } else { NotNativeSpeechOrControl(pageRoutesTasksWallet[37]); }
}

lemma TasksWalletNotNative(route: Route)
  requires route in pageRoutesTasksWallet
  ensures route !in nativeSpeechRoutes
  ensures route !in nativeControlRoutes
{
  assert |pageRoutesTasksWallet| == 38;
  var i :| 0 <= i < 38 && pageRoutesTasksWallet[i] == route;
  if i < 10 { TasksWalletNotNativeA(i); } else if i < 20 { TasksWalletNotNativeB(i); } else if i < 30 { TasksWalletNotNativeC(i); } else { TasksWalletNotNativeD(i); }
}

lemma PageRouteNotNative(route: Route)
  requires route in pageRoutes
  ensures route !in nativeSpeechRoutes
  ensures route !in nativeControlRoutes
{
  if route in pageRoutesCore { CoreNotNative(route); }
  else if route in pageRoutesApps { AppsNotNative(route); }
  else if route in pageRoutesWorkflows { WorkflowsNotNative(route); }
  else { TasksWalletNotNative(route); }
}

lemma lawSpeechRoutesAreAbsentFromThePage_ensures(route: Route)
  ensures (lawSpeechRoutesAreAbsentFromThePage(route) == true)
{
  if route in pageRoutes {
    PageRouteNotNative(route);
  }
}

lemma lawControlNativeRoutesAreAbsentFromThePage_ensures(controlRoute: Route)
  ensures (lawControlNativeRoutesAreAbsentFromThePage(controlRoute) == true)
{
  if controlRoute in pageRoutes {
    PageRouteNotNative(controlRoute);
  }
}

lemma NotOtherCleanup(xs: seq<Route>, m: Method)
  requires m != Method.Post
  requires forall i :: 0 <= i < |xs| ==> xs[i] != Route(m, browserNotesCleanup, false)
  ensures Route(m, browserNotesCleanup, false) !in xs
{
}

lemma lawBrowserNotesCleanupIsOnThePage_ensures(method_: Method)
  ensures (lawBrowserNotesCleanupIsOnThePage(method_) == true)
{
  var r := Route(method_, browserNotesCleanup, false);
  if method_ == Method.Post {
    assert pageRoutesWorkflows[11] == r;
    assert r in pageRoutesWorkflows;
    assert r in pageRoutes;
  } else {
    NotOtherCleanup(pageRoutesCore, method_);
    NotOtherCleanup(pageRoutesApps, method_);
    NotOtherCleanup(pageRoutesWorkflows, method_);
    NotOtherCleanup(pageRoutesTasksWallet, method_);
  }
}
