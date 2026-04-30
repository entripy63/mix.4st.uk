# Subharmonic Summation Curve Peak Landscape

## Background

We recently introduced Subharmonic Summation to detect the fundamental period of the ACF.
Following its visualisation we realised a peak at T/2 could be used to replace the previous complicated ACF odd peak detection and correction. This replaced 40 lines of complicated code with a lack of robustness with far fewer lines of simpler code including very desirable hysteresis.

Further study of peaks in the SHS landscape suggest it may also be possible to replace our complicated and somewhat weak ACF based periodicity detection with simpler more robust code based on further SHS curve peak analysis.

## The SHS Peak Landscape

T/2 is already detected and used to correct an octave error. It uses two thresholds to implement hysteresis and onset is conditional upon space ratio > 1.4 which discriminates between valid T/2 peaks for Jungle and DnB and invalid peaks for Dub Reggae which appear to be caused by ACF waveform asymmetry.

T/3 indicates a periodicity of 6 is required that has not been affected by an organic T/2 detection from the initial SHS T estimator and has not yet been detected by the initial SHS T estimator. In this case div = 3.

2\*T/3 indicated a periodicity of 6 is required that has been affected by an organic T/2 detection from the initial SHS T estimator but has not yet been detected by the initial SHS T estimator. In this case div = 3/2.

At that point I realised this would work fine if we detected the periodicity of 6 and corrected accordingly but not if the periodicity of 6 had actually already been detected by the initial SHS T estimator.

Fortunately there is a solution.

3\*T/2 indicates a periodicity of 6. It is the periodicity 4 peak 1 which has been changed to be peak 1.5 by previous division of T. Periodicity 4 itself has no structure at 3\*T/2.

We can therefore simply detect periodicity in a similar place to now, separately to our detection and correction of periodicity.

Periodicity 10 has been ignored for now. It is very rare and will hopefully be able to be dealt with in a similar way using the SHS.

## Possible Solutions

A simple detection of a significant peak at 3T/2 is all that is required to discriminate between periodicities of 4 and 6.

Some hysteresis of the state may be desirable to prevent flickering between periodicities.

A good first step would be to get this periodicity detection implemented.

It seems likely that periodicity 6 that has not yet been detected organically can be dealt with in a similar way to the T/2 detection and correction. It would require hysteresis using similar thresholds to the T/2 case but the onset should be conditional upon space ratio < 0.9. We don't have this feature yet and rely on the initial SHS T estimation to figure it out eventually so this would be a new feature.

Complications will likely arise from having concurrent detection and correction of T/2, T/3 and 3*T/2. I have not given any thought to whether the hysteresis states should be pre-emptible by the largest detection. It seems likely that none of the detections can coexist. We shouldn't get T/2 at the same time at T/3 and 2\*T/3 and we shouldn't get T/3 at the same time as 2\*T/3. Perhaps it will all just work naturally. That should perhaps be left until after periodicity detection had been implemented by SHS use.


