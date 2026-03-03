# Proposal to Change the UI and UX for handling Live Streams

## Motivation
The UI and UX for live streams is very different to that for DJ mixes, an unsurprising result given we had no idea how live streams would develop when we first implemented the feature. Unfortunately it has become apparent that the different UI and UX is poorer than that for DJ mixes and that a UI and UX much more like that for DJ streams might provide various advantages.

## Problems with Current UI/UX
1. It is different than that for DJ mixes, which is itself a poor UX.
2. No per stream granularity of Play Now. Instead the best you can do is to add all the streams from a Genre, Country or Other Preset in order to play them.
3. No per stream granularity of Adding to User Streams. Instead the best you can do is to add all the streams from a Genre, Country or Other Preset and then reorder them and delete the ones you didn't want. Alternatively you can add a single stream directly, but finding such a stream can be an onerous task so is not expected to be used regularly by users.

## Similar Problem to DJ MIxes
DJ Mixes are browsed by DJ and result in a list of mixes that can individually be Played Now or Added to Queue.
Given that we have many stream Presets, categorized by Genre, Country or Other it would be possible to browse streams by Genre/Country/Other resulting in a list of streams that could individually be Played Now or Added to User Streams.

## Proposal
Change the Browser Live mode tab to act very similarly to that for the Browser DJ/All mode tabs. 
We could have something more like the DJ mode tab, with buttons for the different Genres, Countries and Other categories much like the DJ mode can have buttons for different mix selections. The big difference though is that would need many more buttons, given the large number of Genres and Countries. This probably wouldn't scale very well without becoming cluttered.
That leaves something more like the All mode tab, where a list of all DJs is available by means of a dropdown menu. A similar dropdown menu containing the lists of Genres, Countries an Others presets would be very compact and should scale much better.
An Add All to User Streams button, like the Add All to Queue button at the top of list of DJ mixes would restore the previous behaviour of adding all the streams from a presets in one action, but now as an optional possibility rather than the only possibility.

## Advantages of a New UI/UX
1. It is almost identical to that for DJ mixes All mode, a consistent UI/UX.
2. Per stream granularity of Play Now simply by having a Play Now button on each row of the list of streams, just like rows of DJ mixes are presented.
3. Per stream granularity of Add to User Streams simply by having an Add to User Streams button on each row of the list of streams, just like rows of DJ mixes are presented.

## What happens to the old Live UI?
The issue with replacing the current Live mode UI is that the current UI then has no natural home. I would propose that the User Streams UI that currently exists is moved to a new tabbed interface in the centre column of the three column player.html SPA. That centre column would then have two tabs 'Mix Queue' and 'User Streams'. Both of those would bring up a list that could be re-ordered by the user.
The 'Mix Queue' tab would bring up the existing Queue UI.
The 'User Streams' tab would bring up the existing Live mode UI.

## Remaining Questions
1. Should it be possible to Favourite live streams? Probably, I can't see any reason why not.
2. Should it be possible to Hide live streams? Probably, again I can't see any reason why not.

## UX Behaviour
Apart from the obvious UX behaviour apparent from the current All mode and Live mode behaviour a few optmisations should be possible.
Specifically, if a user Adds to Queue the centre column should automatically display the 'Mix Queue" tab. If a user Adds to User Streams the centre column should automatically display the 'User Streams' tab.

## Implementation
I would suggest that initially the existing Live mode UI first be moved to a new tabbed centre column leaving nothing more than the Add Genre, Add Country and Add Other buttons as the remaining Live mode UI. Once that is working we can change the Browser Live mode to be similar to All mode.