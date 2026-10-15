// DIRECTV channel lineup for the New York market (DMA 501), as listed on
// https://www.directv.com/channel-lineup/ for ZIP 07764 (Monmouth County, NJ) on
// 15 Oct 2026: every package (Entertainment, Choice, Ultimate, Premier), add-ons,
// regional sports networks and the free MyFree DIRECTV channels.
// Format per line: number|name|flags   (flags: F = MyFree DIRECTV, A = add-on)
// Left out on purpose: "Mix" screens, DIRECTV 4K Live event feeds, overflow/alternate
// feeds and per-game slots (MLS / F1 / Friday Night Baseball on Apple TV, NBA League
// Pass, WNBA on ION), which aren't channels a playlist would carry.

/** Local stations for ZIP 07764 (DIRECTV's local-channel lookup). */
export const DIRECTV_NY_LOCALS = `2|WCBS|CBS
4|WNBC|NBC
5|WNYW|FOX
7|WABC|ABC
9|WWOR|MyNetworkTV
11|WPIX|CW
13|WNET|PBS
41|WXTV|Univision
47|WNJU|Telemundo
49|WEDW|PBS
50|WNJN|PBS
55|WLNY|Independent
4051|WABCFAST|ABC7 New York`;

export const DIRECTV_NY = `77|MeTV|
80|Cozi TV|
81|GRIT|
82|BounceTV|
83|GREAT|
84|Start TV|
85|True CRMZ|
86|MovieSphere Gold|
88|ION Mystery|
202|CNN|
204|HLN|
206|ESPN|
207|ESPNews|
208|ESPNU|
209|ESPN2|
211|NFL Red Zone|A
212|NFL Network|
213|MLB Network|
214|RACER Network|
215|NHL Network HD|
216|NBA TV|
217|Tennis Channel HD|
218|Golf Channel|
219|FOX Sports 1|
221|CBS Sports Network HD|
226|Shop LC|
228|GEM Shopping Network|
229|HGTV|
230|Magnolia Network|
231|Food Network|
232|Cooking Channel|
233|GSN HD|
235|Tastemade|F
236|E!|
237|Bravo|
238|ReelzChannel HD|
239|Sundance TV|
240|Home Shopping Network|
241|Paramount TV|
242|USA Network|
244|Syfy|
245|TNT|
246|truTV|
247|TBS|
248|FX|
249|Comedy Central|
251|Oxygen True Crime|
252|Lifetime|
253|Lifetime Movie Network|
254|AMC|
256|TCM|
258|FX Movie Channel|
259|FXX|
260|WE TV|
261|Discovery Life|
264|BBC America|
265|A&E|
266|FYI|
267|EarthX|
269|HISTORY|
271|VICE|
272|LOGO HD|
273|POP HD|
274|Ovation HD|
275|QVC HD|
276|National Geographic Channel|
277|Travel Channel|
278|Discovery|
279|OWN|
280|TLC|
281|Discovery Turbo|
282|Animal Planet|
283|Nat Geo WILD|
284|Science|
285|Investigation Discovery|
286|Destination America HD|
287|American Heroes|
288|PBS Kids|
289|Disney Junior HD|
290|Disney Channel HD|
292|Disney XD HD|
293|Baby First HD|
294|Discovery Family Channel|
295|MeTV Toons|
296|Cartoon Network|A
298|Boomerang|
299|Nickelodeon East HD|
301|Nick Jr.|
302|Nicktoons|
303|TeenNick|
304|TV Land|
305|ION East|
307|NewsNation|
308|LooLoo Kids|
311|Freeform HD|
312|Hallmark Channel|
313|Jewelry TV|
314|Family Movie Classics|
315|QVC2|
318|QVC3|
320|Scientology Network|
323|Family Entertainment Television|
326|Great American Family|
327|CMT|
328|TV One|
329|BET|
330|BET Her|
331|MTV|
332|MTV2|
333|IFC|
334|Revolt|
335|VH1|
336|MTV Classic|
338|UP|
339|Fuse|
340|AXS TV|
341|Cleo TV|
342|theGrio|
343|i24 News|
345|RFD-TV|
346|BBC News|F
347|The First|F
349|Newsmax TV|
350|C-SPAN|
351|C-SPAN2|
352|C-SPAN3|
353|Bloomberg TV|
354|Cheddar News|F
355|CNBC|
356|MS Now|
357|CNBC World|
358|CNNi HD East|
359|Fox Business Network|
360|Fox News Channel|
361|AccuWeather|F
362|The Weather Channel HD|
363|FOX Weather|F
364|INSP HD|A
369|Daystar|
381|ASPIRE|
382|Comedy TV|
383|Justice Central HD|
385|Heroes & Icons|
386|FM|
387|RecipeTV|
402|Univision East HD|
404|Galavision|
405|MegaTV HD|A
408|UniMas West HD|
409|VePlus|A
410|UNIVERSO|
411|Telefe|A
412|Multimedios|A
413|Discovery en Espanol|A
414|WAPA America|A
415|Videorola|A
416|Nuestra Tele|A
417|Caracol TV|A
418|NTN24|A
419|CNN en Espanol|
420|Atres Series|A
422|Cine Estelar|A
423|Cinelatino|A
424|Cine Nostalgia|A
428|Centroamerica TV|A
429|TeleCentro|A
430|Hola TV|A
432|ZooMoo|A
433|Bandamax|A
434|Hogar de HGTV|A
435|NatGeo Mundo|A
436|Discovery Familia|A
437|TV Chile|A
438|Ecuavisa Internacional|A
439|SUR Peru|A
440|Vme|A
442|Estrella TV|A
443|History en Espanol|A
444|Pasiones|A
445|Tr3s|A
446|Canal 22 Internacional|A
447|Canal Once|A
448|Enlace|A
449|Sony Cine|A
450|Cinema Dinamita|A
451|De Pelicula|A
452|De Pelicula Clasico|A
453|FOROtv|A
454|Univision tlnovelas|A
457|TC Internacional|A
458|Antena 3|A
459|Atres Cine|A
460|TVE|A
461|HITN|A
462|Cine Mexicano|A
463|Daystar Espanol|A
464|TUDN|
465|FOX Deportes HD|A
466|ESPN Deportes HD|A
467|Vix Deportes 24/7|F
468|Fanatiz 1|A
469|TyC Sports|A
470|beIN SPORTS XTRA en Español|F
471|PX Sports|A
472|Nuestra Vision|A
473|Estrella News|A
474|Meganoticias|A
475|EWTN Espanol|A
501|HBO East|
502|HBO Hits HD East|
503|HBO Drama HD East|
506|HBO Comedy East HD|
509|HBO Movies HD|
511|HBO Latino|
515|Cinemax East|
517|Cinemax Hits HD|
519|Cinemax Action|
520|Cinemax Classics HD|
523|Cinemax HD|
525|STARZ East|
527|STARZ Kids & Family|
528|STARZ Comedy HD|
529|STARZ Edge HD|
530|STARZ in Black HD|
531|STARZ Cinema HD|
535|STARZ Encore East|
536|STARZ ENCORE West|
537|STARZ ENCORE Classic|
538|STARZ ENCORE Westerns|
539|STARZ ENCORE Suspense|
540|STARZ ENCORE Black|
541|STARZ Encore Action HD|
542|STARZ ENCORE Family|
545|Paramount+ with Showtime East HD|
547|SHOWTIME 2 HD|
548|SHOxBET HD|
549|Showtime Extreme HD|
550|Showtime Showcase HD|
551|Showtime Next HD|
552|SHOWTIME Family Zone HD|
557|AMC+|A
558|MGM+|A
559|MGM+ HITS|A
560|MGM+ MARQUEE|A
562|Dog TV|A
564|Hallmark Family|A
565|Hallmark Mystery|
566|HDNET MOVIES|
568|Sony Movies HD|A
570|Smithsonian Channel HD|
573|Shorts TV HD|
602|FanDuel TV|
603|Cowboy Channel|
604|Pursuit Channel|
605|Sportsman Channel|
606|Outdoor Channel HD|A
610|Big Ten|
611|SEC Network|
612|ACC Network|
618|FOX Sports 2|
619|NBC Sports 1|A
623|Next Level Sports HD|A
625|Willow HD|A
626|Willow 2|A
628|NESN|A
630|NBC Sports Boston|A
631|YES Network HD|A
634|MSG|A
635|MSG Sportsnet|A
639|SportsNet New York|A
640|MASN|A
642|Monumental Sports Network|A
653|NHL Tampa Bay Lightning|
659|SportsNet Pittsburgh|A
664|Marquee Sports Network|A
665|Chicago Sports Network|A
674|Space City Home Network|A
681|Altitude Sports|A
688|NBA Blazers|
690|Spectrum SportsNet LA|A
691|Spectrum SportsNet|A
692|Angels Broadcast Television|A
696|NBC Sports Bay Area|A
698|NBC Sports California|A
2030|SBTN|A
2031|VGN TV|A
2032|TViet Network|A
2033|Vietface TV|A
2034|S Channel|A
2035|Vien Thao TV|A
2036|Vie TV|A
2037|Film 24H|A
2038|Honvietv|A
2080|SBS HD|A
2081|MBC|A
2082|KBS America|A
2083|YTN|A
2084|SBS Plus|A
2086|LifeS|A
2087|EBS|A
2088|MBN|A
2089|Tan TV|A
2092|CTS|A
2095|Arirang TV|A
2134|TV Globo|A
4004|NBC News Now|F
4005|Today All Day|F
4007|ABC News Live|F
4008|ABC Localish|F
4009|Scripps News|F
4010|20/20|F
4021|Yahoo Finance|F
4101|Yahoo Sports|F
4105|SportsGrid|F
4106|DraftKings|F
4108|ESPN8: The Ocho|F
4110|Fuel TV|F
4111|Fox Sports|F
4113|The MLB Channel|F
4114|NBA FAST Channel|F
4116|GolfPass|F
4117|Tennis Channel 2|F
4118|Surf Cinema|F
4119|Red Bull TV|F
4121|DP World Tour|F
4122|beIN SPORTS XTRA|F
4123|Willow Sports|F
4125|Women's Sports Network|F
4126|All Women's Sports|F
4130|Fight Network|F
4131|TNA|F
4132|Swerve Combat|F
4133|DAZN Ringside|F
4140|PokerGo|F
4141|Pickleball TV|F
4148|Billiard TV|F
4149|Ryz Sports|F
4150|Stadium Stream|F
4151|ACC Digital Network|F
4152|Big 12|F
4170|WIRED2fish TV|F
4172|Pursuit UP|F
4175|Waypoint TV|F
4180|NBC Sports Now|F
4181|The Jim Rome Show|F
4189|Sports Illustrated|F
4190|Players TV|F
4191|PowerNation|F
4192|Racing America|F
4193|Torque by History|F
4194|Speedvision|F
4195|F1|F
4196|Moto GP|F
4200|Lionsgate Collection|F
4201|Primetime Soaps|F
4204|Acorn TV Mysteries|F
4209|HerSphere|F
4218|Three Stooges|F
4219|Bob Ross Channel|F
4221|Horror by Alter|F
4227|The Walking Dead Universe|F
4228|50 Cent Action Channel|F
4229|El Rey Rebel|F
4230|Court TV|F
4250|Bravo Vault|F
4251|Real Housewives Vault|F
4252|E! Keeping Up|F
4253|All Reality WeTV|F
4254|Confess by Nosey|F
4255|Nosey|F
4256|Dance Moms by Lifetime|F
4257|Say Yes To The Dress|F
4258|The Repair Shop|F
4260|The Masked Singer|F
4261|America's Got Talent|F
4262|Duck Dynasty|F
4263|Ice Road Truckers|F
4264|Ax Men|F
4265|Rig TV|F
4268|Danger TV|F
4269|Love After Lockup|F
4270|The First 48|F
4271|Cold Case Files|F
4272|Crime 360|F
4274|True Crime Now|F
4275|Law & Crime|F
4279|Car Chase Channel|F
4281|Crime Scenes|F
4282|I (Almost) Got Away With It|F
4283|Living With Evil|F
4284|Love Kills|F
4287|Oxygen True Crime Archives|F
4288|Dateline 24/7|F
4301|Fail Army|F
4303|Always Funny|F
4304|America's Funniest Home Videos|F
4305|Comedy Dynamics|F
4310|SNL Vault|F
4321|Anger Management|F
4322|Are We There Yet|F
4324|Portlandia|F
4325|Stories by AMC|F
4328|INFAST|F
4329|INWONDER|F
4335|Buzzr|F
4336|Family Feud (Steve Harvey)|F
4337|Let's Make a Deal|F
4338|The Price is Right: Drew Carey|F
4339|The Price is Right: The Barker Era|F
4340|Deal Zone|F
4341|Supermarket Sweep|F
4342|Game Show Central|F
4346|Dog Whisperer|F
4352|Million Dollar Listing Vault|F
4357|America's Test Kitchen|F
4358|Tastemade Travel|F
4359|Tastemade Home|F
4361|Jamie Oliver|F
4363|Tiny House Nation|F
4364|Military Makeover Channel|F
4365|The Design Network|F
4366|RVTV|F
4367|AT HOME with family handyman|F
4368|Great American Romcoms|F
4370|MeatEater|F
4372|Gusto TV|F
4378|Sweet Escapes|F
4379|Bizarre Foods with Andrew Zimmern|F
4380|Beach Day|F
4388|GoTraveler|F
4401|FOX Soul|F
4404|Ebony TV|F
4416|Dove TV|F
4418|Joel Osteen|F
4421|Pureflix TV|F
4449|Yu-Gi-Oh!|F
4470|Love Nature|F
4476|Cosmic Frontiers|F
4477|Mythbusters|F
4480|Modern Marvels|F
4481|Curiosity Now|F
4482|MagellanTV Wildest|F
4484|Military Heroes|F
4486|History & Warfare|F
4487|How To|F
4490|Alien Nation by DUST|F
4491|UnXplained Zone|F
4493|Ghosts are Real|F
4494|Mysterious Worlds|F
4501|MovieSphere|F
4504|Movie Favorites by Lifetime|F
4510|At the Movies|F
4511|Classic Cinema|F
4520|Tribeca Festival+|F
4540|Documentary+|F
4551|INSP Western Bound|F
4720|Somos Novelas|F
4721|The Pet Collective|F`;
