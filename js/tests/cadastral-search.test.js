import { describe, it, expect } from 'vitest'
import {
    parseSurveyQuery,
    normalizeSurveySegment,
    scoreSurveyMatch,
} from '../cadastral-search.js'

describe('parseSurveyQuery', () => {
    it('parses survey-only input', () => {
        expect(parseSurveyQuery('1')).toEqual({
            surveyPrefix: '1',
            subdivPrefix: null,
            hasSubdiv: false,
        })
    })

    it('parses survey with trailing slash', () => {
        expect(parseSurveyQuery('1/')).toEqual({
            surveyPrefix: '1',
            subdivPrefix: '',
            hasSubdiv: true,
        })
    })

    it('parses survey and subdiv', () => {
        expect(parseSurveyQuery('1/1')).toEqual({
            surveyPrefix: '1',
            subdivPrefix: '1',
            hasSubdiv: true,
        })
    })

    it('normalises separators within segments', () => {
        expect(parseSurveyQuery('1/2-A')).toEqual({
            surveyPrefix: '1',
            subdivPrefix: '2a',
            hasSubdiv: true,
        })
        expect(parseSurveyQuery('1 2-A')).toEqual({
            surveyPrefix: '12a',
            subdivPrefix: null,
            hasSubdiv: false,
        })
    })
})

describe('scoreSurveyMatch', () => {
    it('ranks survey 1 above 101 for query "1"', () => {
        const parsed = parseSurveyQuery('1')
        const scoreExact = scoreSurveyMatch({ survey: '1', subdiv: '1' }, parsed)
        const scoreHundredOne = scoreSurveyMatch({ survey: '101', subdiv: '3' }, parsed)

        expect(scoreExact).toBeGreaterThan(scoreHundredOne)
    })

    it('ranks survey 1 above 101 for query "1/"', () => {
        const parsed = parseSurveyQuery('1/')
        const scoreExact = scoreSurveyMatch({ survey: '1', subdiv: '1' }, parsed)
        const scoreHundredOne = scoreSurveyMatch({ survey: '101', subdiv: '3' }, parsed)

        expect(scoreExact).toBeGreaterThan(scoreHundredOne)
    })

    it('ranks 1/1 above 1/11 for query "1/1"', () => {
        const parsed = parseSurveyQuery('1/1')
        const scoreExact = scoreSurveyMatch({ survey: '1', subdiv: '1' }, parsed)
        const scoreEleven = scoreSurveyMatch({ survey: '1', subdiv: '11' }, parsed)

        expect(scoreExact).toBeGreaterThan(scoreEleven)
    })

    it('matches equivalent normalisation', () => {
        const parsed = parseSurveyQuery('1/2-A')
        expect(scoreSurveyMatch({ survey: '1', subdiv: '2-A' }, parsed)).not.toBeNull()
        expect(scoreSurveyMatch({ survey: '1', subdiv: '2A' }, parsed)).not.toBeNull()
    })

    it('rejects non-matching survey prefix', () => {
        const parsed = parseSurveyQuery('2')
        expect(scoreSurveyMatch({ survey: '1', subdiv: '1' }, parsed)).toBeNull()
    })
})

describe('normalizeSurveySegment', () => {
    it('strips non-alphanumeric characters', () => {
        expect(normalizeSurveySegment('2-A')).toBe('2a')
        expect(normalizeSurveySegment('')).toBe('')
    })
})
